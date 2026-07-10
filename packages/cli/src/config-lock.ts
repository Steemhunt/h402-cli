import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, readlink, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type LinuxProcessIdentity = {
  machineIdHash: string;
  bootId: string;
  pidNamespace: string;
  startTicks: string;
};

type ConfigLockOwner = {
  version: 2;
  pid: number;
  hostname: string;
  createdAt: string;
  token: string;
  linuxProcess?: LinuxProcessIdentity;
};

type ConfigLockObservation = {
  identity?: string;
  reclaimable: boolean;
  reason: string;
};

type LockOwnerState = {
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

let nativeLockApiPromise: Promise<NativeLockApi | undefined> | undefined;

async function loadNativeLockApi(): Promise<NativeLockApi | undefined> {
  nativeLockApiPromise ??= import("fs-native-extensions")
    .then(({ tryLock, unlock }) => ({ tryLock, unlock }))
    .catch(() => undefined);
  return nativeLockApiPromise;
}

async function acquireOperationGuardWithApi(
  dir: string,
  api: NativeLockApi,
  attempts: number
): Promise<ConfigLockRelease | undefined> {
  const guardPath = path.join(dir, CONFIG_LOCK_GUARD_FILE);
  const handle: FileHandle = await open(guardPath, "a+", 0o600);
  await chmod(guardPath, 0o600).catch(() => undefined);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (api.tryLock(handle.fd)) {
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          api.unlock(handle.fd);
        } finally {
          await handle.close();
        }
      };
    }
    if (attempt + 1 < attempts) await delay(CONFIG_LOCK_WAIT_MS);
  }
  await handle.close();
  return undefined;
}

export async function acquireConfigLockOperationGuard(dir: string): Promise<ConfigLockRelease> {
  const api = await loadNativeLockApi();
  if (!api) {
    throw new Error("Native file locking is unavailable; h402 cannot safely coordinate config-lock reclamation on this platform.");
  }
  const release = await acquireOperationGuardWithApi(dir, api, CONFIG_LOCK_WAIT_ATTEMPTS);
  if (!release) {
    throw new Error(`Timed out waiting for h402 config-lock operation guard at ${path.join(dir, CONFIG_LOCK_GUARD_FILE)}.`);
  }
  return release;
}

function isLinuxProcessIdentity(value: unknown): value is LinuxProcessIdentity {
  if (!isPlainObject(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.machineIdHash === "string" &&
    identity.machineIdHash.length > 0 &&
    typeof identity.bootId === "string" &&
    identity.bootId.length > 0 &&
    typeof identity.pidNamespace === "string" &&
    identity.pidNamespace.length > 0 &&
    typeof identity.startTicks === "string" &&
    identity.startTicks.length > 0
  );
}

function isConfigLockOwner(value: unknown): value is ConfigLockOwner {
  if (!isPlainObject(value)) return false;
  const owner = value as Record<string, unknown>;
  return (
    owner.version === 2 &&
    Number.isSafeInteger(owner.pid) &&
    (owner.pid as number) > 0 &&
    typeof owner.hostname === "string" &&
    owner.hostname.length > 0 &&
    typeof owner.createdAt === "string" &&
    Number.isFinite(Date.parse(owner.createdAt)) &&
    typeof owner.token === "string" &&
    owner.token.length > 0 &&
    (owner.linuxProcess === undefined || isLinuxProcessIdentity(owner.linuxProcess))
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

async function readLinuxHostIdentity(): Promise<Omit<LinuxProcessIdentity, "startTicks"> | undefined> {
  if (process.platform !== "linux") return undefined;
  try {
    const [rawMachineId, bootId, pidNamespace] = await Promise.all([
      readFile("/etc/machine-id", "utf8"),
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readlink("/proc/self/ns/pid")
    ]);
    if (!rawMachineId.trim() || !bootId.trim() || !pidNamespace.trim()) return undefined;
    const machineIdHash = createHash("sha256").update("h402-config-lock\0").update(rawMachineId.trim()).digest("hex");
    return { machineIdHash, bootId: bootId.trim(), pidNamespace: pidNamespace.trim() };
  } catch {
    return undefined;
  }
}

async function readLinuxProcessStartTicks(pid: number): Promise<string> {
  const raw = await readFile(`/proc/${pid}/stat`, "utf8");
  const commandEnd = raw.lastIndexOf(")");
  if (commandEnd < 0) throw new Error(`Could not parse /proc/${pid}/stat`);
  const fieldsAfterCommand = raw.slice(commandEnd + 1).trim().split(/\s+/);
  const startTicks = fieldsAfterCommand[19];
  if (!startTicks) throw new Error(`Could not read process start time for PID ${pid}`);
  return startTicks;
}

async function currentLinuxProcessIdentity(): Promise<LinuxProcessIdentity | undefined> {
  const host = await readLinuxHostIdentity();
  if (!host) return undefined;
  try {
    return { ...host, startTicks: await readLinuxProcessStartTicks(process.pid) };
  } catch {
    return undefined;
  }
}

async function inspectLockOwner(owner: ConfigLockOwner): Promise<LockOwnerState> {
  const recorded = owner.linuxProcess;
  const current = await readLinuxHostIdentity();
  if (!recorded || !current) {
    return { reclaimable: false, reason: `owner PID ${owner.pid} on ${owner.hostname} has no process identity that can be verified on this platform` };
  }
  if (recorded.machineIdHash !== current.machineIdHash) {
    return { reclaimable: false, reason: `owner PID ${owner.pid} belongs to a different machine instance` };
  }
  if (recorded.bootId !== current.bootId) {
    return { reclaimable: true, reason: `owner PID ${owner.pid} belongs to an earlier boot of this machine` };
  }
  if (recorded.pidNamespace !== current.pidNamespace) {
    return { reclaimable: false, reason: `owner PID ${owner.pid} belongs to a different PID namespace` };
  }
  try {
    const startTicks = await readLinuxProcessStartTicks(owner.pid);
    if (startTicks !== recorded.startTicks) {
      return { reclaimable: true, reason: `owner PID ${owner.pid} was reused by another process` };
    }
    return { reclaimable: false, reason: `live PID ${owner.pid} on ${owner.hostname} since ${owner.createdAt}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { reclaimable: true, reason: `owner PID ${owner.pid} no longer exists in its recorded process namespace` };
    }
    return { reclaimable: false, reason: `owner PID ${owner.pid} could not be verified: ${(error as Error).message}` };
  }
}

async function inspectConfigLock(lockDir: string): Promise<ConfigLockObservation> {
  try {
    const owner = await readConfigLockOwner(lockDir);
    if (owner) {
      const state = await inspectLockOwner(owner);
      return { identity: `owner:${owner.token}`, ...state };
    }

    const lockStat = await stat(lockDir);
    const ageMs = Math.max(0, Date.now() - lockStat.mtimeMs);
    return {
      identity: `unverifiable:${lockStat.dev}:${lockStat.ino}:${lockStat.mtimeMs}`,
      reclaimable: false,
      reason: `lock has no valid owner metadata; automatic reclamation is unsafe (${Math.round(ageMs)}ms old)`
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { reclaimable: false, reason: "lock disappeared while being inspected" };
    return { reclaimable: false, reason: `lock ownership could not be inspected: ${(error as Error).message}` };
  }
}

async function reclaimConfigLockIfUnchanged(lockDir: string, observed: ConfigLockObservation): Promise<boolean> {
  if (!observed.reclaimable || !observed.identity) return false;
  const api = await loadNativeLockApi();
  // Without a kernel-backed guard, automatic deletion is unsafe. Preserve the
  // lock and let the normal timeout provide manual recovery guidance instead.
  if (!api) return false;
  const releaseGuard = await acquireOperationGuardWithApi(path.dirname(lockDir), api, 1);
  if (!releaseGuard) return false;

  try {
    const current = await inspectConfigLock(lockDir);
    if (!current.reclaimable || current.identity !== observed.identity) return false;
    try {
      await rm(lockDir, { recursive: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  } finally {
    await releaseGuard();
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
  // Resolve any platform-specific process identity before publishing the lock
  // directory, keeping the ownerless initialization window to one local write.
  const linuxProcess = await currentLinuxProcessIdentity();
  let lastObservation: ConfigLockObservation = { reclaimable: false, reason: "lock is contended" };

  let waitedAttempts = 0;
  while (waitedAttempts < CONFIG_LOCK_WAIT_ATTEMPTS) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      const owner: ConfigLockOwner = {
        version: 2,
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        token,
        ...(linuxProcess ? { linuxProcess } : {})
      };
      try {
        await writeFile(path.join(lockDir, CONFIG_LOCK_OWNER_FILE), JSON.stringify(owner), { mode: 0o600, flag: "wx" });
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return async () => {
        const api = await loadNativeLockApi();
        const releaseGuard = api
          ? await acquireOperationGuardWithApi(dir, api, CONFIG_LOCK_WAIT_ATTEMPTS)
          : undefined;
        if (api && !releaseGuard) {
          throw new Error(`Refusing to release h402 config lock at ${lockDir}: ownership validation is already in progress.`);
        }
        try {
          const currentOwner = await readConfigLockOwner(lockDir);
          if (!currentOwner) {
            throw new Error(`Refusing to release h402 config lock at ${lockDir}: owner metadata is missing or invalid.`);
          }
          if (currentOwner.token !== owner.token) {
            throw new Error(`Refusing to release h402 config lock at ${lockDir}: ownership changed to PID ${currentOwner.pid} on ${currentOwner.hostname}.`);
          }
          await rm(lockDir, { recursive: true, force: true });
        } finally {
          await releaseGuard?.();
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      lastObservation = await inspectConfigLock(lockDir);
      if (await reclaimConfigLockIfUnchanged(lockDir, lastObservation)) {
        // Reclamation is not a wait attempt; retry mkdir even at the deadline.
        continue;
      }
      waitedAttempts += 1;
      if (waitedAttempts < CONFIG_LOCK_WAIT_ATTEMPTS) {
        await delay(CONFIG_LOCK_WAIT_MS);
      }
    }
  }
  throw lockTimeoutError(lockDir, lastObservation);
}
