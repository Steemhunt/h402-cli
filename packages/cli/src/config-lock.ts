import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ConfigLockOwner = {
  version: 3;
  pid: number;
  hostname: string;
  createdAt: string;
  token: string;
};

type ConfigLockObservation = {
  token?: string;
  reclaimable: boolean;
  reason: string;
};

const CONFIG_LOCK_OWNER_FILE = "owner.json";
const CONFIG_LOCK_GUARD_FILE = ".config.lock.guard";
const CONFIG_LOCK_WAIT_ATTEMPTS = 200;
const CONFIG_LOCK_WAIT_MS = 25;

type NativeLockApi = {
  tryLock(fd: number): boolean;
  unlock(fd: number): void;
};

type ConfigLockRelease = () => Promise<void>;

type NativeLockLoad = {
  api?: NativeLockApi;
  reason?: string;
};

type ReclaimResult = {
  reclaimed: boolean;
  blockedReason?: string;
};

let nativeLockLoadPromise: Promise<NativeLockLoad> | undefined;

function errorDescription(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code ? `${code}: ${message}` : message;
}

async function loadNativeLockApi(): Promise<NativeLockLoad> {
  nativeLockLoadPromise ??= import("fs-native-extensions")
    .then(({ tryLock, unlock }) => ({ api: { tryLock, unlock } }))
    .catch((error: unknown) => ({ reason: errorDescription(error) }));
  return nativeLockLoadPromise;
}

async function tryAcquireReclamationGuard(dir: string): Promise<{ release?: ConfigLockRelease; reason?: string }> {
  const loaded = await loadNativeLockApi();
  if (!loaded.api) {
    return { reason: `config-lock reclamation guard is unavailable (${loaded.reason ?? "native file locking could not be loaded"})` };
  }

  const guardPath = path.join(dir, CONFIG_LOCK_GUARD_FILE);
  let handle: FileHandle;
  try {
    handle = await open(guardPath, "a+", 0o600);
    await chmod(guardPath, 0o600).catch(() => undefined);
  } catch (error) {
    return { reason: `config-lock reclamation guard could not be opened (${errorDescription(error)})` };
  }

  let acquired = false;
  try {
    try {
      acquired = loaded.api.tryLock(handle.fd);
    } catch (error) {
      return { reason: `config-lock reclamation guard failed (${errorDescription(error)})` };
    }
    if (!acquired) return {};

    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        try {
          loaded.api?.unlock(handle.fd);
        } catch {
          // Closing the descriptor releases the kernel lock even if explicit
          // unlock is unsupported or fails at runtime.
        } finally {
          await handle.close().catch(() => undefined);
        }
      }
    };
  } finally {
    if (!acquired) await handle.close().catch(() => undefined);
  }
}

function isConfigLockOwner(value: unknown): value is ConfigLockOwner {
  if (!isPlainObject(value)) return false;
  const owner = value as Record<string, unknown>;
  return (
    owner.version === 3 &&
    Number.isSafeInteger(owner.pid) &&
    (owner.pid as number) > 0 &&
    typeof owner.hostname === "string" &&
    owner.hostname.length > 0 &&
    typeof owner.createdAt === "string" &&
    Number.isFinite(Date.parse(owner.createdAt)) &&
    typeof owner.token === "string" &&
    owner.token.length > 0
  );
}

async function readConfigLockOwner(lockDir: string): Promise<ConfigLockOwner | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.join(lockDir, CONFIG_LOCK_OWNER_FILE), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isConfigLockOwner(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Signal-0 liveness: ESRCH proves no process with that PID exists now, so a
// same-host owner reporting ESRCH is definitively dead. A PID that was reused
// by another process reads as alive — that only degrades to the conservative
// manual-recovery path, never to deleting a live owner's lock. (A sibling
// container sharing this config dir AND this hostname across PID namespaces is
// outside this envelope; hostname is the machine boundary here.)
function ownerProcessAlive(pid: number): boolean | undefined {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return undefined;
  }
}

async function inspectConfigLock(lockDir: string): Promise<ConfigLockObservation> {
  try {
    const owner = await readConfigLockOwner(lockDir);
    if (!owner) {
      const lockStat = await stat(lockDir);
      const ageMs = Math.max(0, Date.now() - lockStat.mtimeMs);
      return {
        reclaimable: false,
        reason: `lock has no valid owner metadata; automatic reclamation is unsafe (${Math.round(ageMs)}ms old)`
      };
    }
    if (owner.hostname !== os.hostname()) {
      return { token: owner.token, reclaimable: false, reason: `owner PID ${owner.pid} on ${owner.hostname} cannot be verified from this host` };
    }
    const alive = ownerProcessAlive(owner.pid);
    if (alive === false) {
      return { token: owner.token, reclaimable: true, reason: `owner PID ${owner.pid} no longer exists` };
    }
    if (alive === true) {
      return { token: owner.token, reclaimable: false, reason: `live PID ${owner.pid} on ${owner.hostname} since ${owner.createdAt}` };
    }
    return { token: owner.token, reclaimable: false, reason: `owner PID ${owner.pid} could not be verified` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { reclaimable: false, reason: "lock disappeared while being inspected" };
    return { reclaimable: false, reason: `lock ownership could not be inspected: ${(error as Error).message}` };
  }
}

// Reclamation is serialized by a crash-released kernel advisory lock. A stale
// observer must re-read the canonical owner while holding the guard; it never
// moves an unverified successor out of the coordination path.
async function reclaimConfigLockIfUnchanged(lockDir: string, observed: ConfigLockObservation): Promise<ReclaimResult> {
  if (!observed.reclaimable || !observed.token) return { reclaimed: false };

  const guard = await tryAcquireReclamationGuard(path.dirname(lockDir));
  if (!guard.release) return { reclaimed: false, blockedReason: guard.reason };

  try {
    const current = await inspectConfigLock(lockDir);
    if (!current.reclaimable || current.token !== observed.token) return { reclaimed: false };
    try {
      await rm(lockDir, { recursive: true });
      return { reclaimed: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { reclaimed: false };
      throw error;
    }
  } finally {
    await guard.release();
  }
}

function lockTimeoutError(lockDir: string, observation: ConfigLockObservation): Error {
  return new Error(
    `Timed out waiting for h402 config lock at ${lockDir} (${observation.reason}). ` +
      `If no h402 process is writing config, remove this lock path and retry; do not remove it while its owner is active.`
  );
}

export async function acquireConfigLock(dir: string) {
  const lockDir = path.join(dir, ".config.lock");
  const token = randomUUID();
  let lastObservation: ConfigLockObservation = { reclaimable: false, reason: "lock is contended" };

  let waitedAttempts = 0;
  while (waitedAttempts < CONFIG_LOCK_WAIT_ATTEMPTS) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      const owner: ConfigLockOwner = {
        version: 3,
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        token
      };
      try {
        await writeFile(path.join(lockDir, CONFIG_LOCK_OWNER_FILE), JSON.stringify(owner), { mode: 0o600, flag: "wx" });
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return async () => {
        const currentOwner = await readConfigLockOwner(lockDir);
        if (!currentOwner) {
          throw new Error(`Refusing to release h402 config lock at ${lockDir}: owner metadata is missing or invalid.`);
        }
        if (currentOwner.token !== token) {
          throw new Error(`Refusing to release h402 config lock at ${lockDir}: ownership changed to PID ${currentOwner.pid} on ${currentOwner.hostname}.`);
        }
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      lastObservation = await inspectConfigLock(lockDir);
      const reclamation = await reclaimConfigLockIfUnchanged(lockDir, lastObservation);
      if (reclamation.reclaimed) {
        // Reclamation is not a wait attempt; retry mkdir even at the deadline.
        continue;
      }
      if (reclamation.blockedReason) {
        lastObservation = {
          ...lastObservation,
          reclaimable: false,
          reason: `${lastObservation.reason}; ${reclamation.blockedReason}`
        };
      }
      waitedAttempts += 1;
      if (waitedAttempts < CONFIG_LOCK_WAIT_ATTEMPTS) {
        await delay(CONFIG_LOCK_WAIT_MS);
      }
    }
  }
  throw lockTimeoutError(lockDir, lastObservation);
}
