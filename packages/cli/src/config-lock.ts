import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
const CONFIG_LOCK_WAIT_ATTEMPTS = 200;
const CONFIG_LOCK_WAIT_MS = 25;
const RECLAIM_CLAIM_PREFIX = ".config.lock.reclaim-";
// A reclaim claim lives for microseconds; one this old can only be the leftover
// of a reclaimer that died mid-claim. It is inert (never the lock path itself).
const STALE_RECLAIM_CLAIM_MS = 600_000;

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

// Reclaim by atomic claim: exactly one contender wins the rename (losers get
// ENOENT), so two reclaimers can never both delete, and a lock released and
// recreated between inspect and rename is detected by the token re-check and
// put back instead of deleted.
async function reclaimConfigLockIfUnchanged(lockDir: string, observed: ConfigLockObservation): Promise<boolean> {
  if (!observed.reclaimable || !observed.token) return false;
  const claimDir = path.join(path.dirname(lockDir), `${RECLAIM_CLAIM_PREFIX}${randomUUID()}`);
  try {
    await rename(lockDir, claimDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const claimedOwner = await readConfigLockOwner(claimDir).catch(() => undefined);
  if (claimedOwner?.token === observed.token) {
    await rm(claimDir, { recursive: true, force: true });
    return true;
  }
  try {
    await rename(claimDir, lockDir);
  } catch {
    // The lock path was recreated in the gap; the displaced dir belongs to an
    // owner we could not verify, so leave it for the stale-claim sweep rather
    // than deleting it. That owner's release fails loudly on the token check.
  }
  return false;
}

// Crashed-reclaimer hygiene: claim dirs are inert garbage once abandoned —
// they are never the lock path — so age-based cleanup is safe for them.
async function sweepStaleReclaimClaims(dir: string) {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(RECLAIM_CLAIM_PREFIX)) continue;
    const claimPath = path.join(dir, entry);
    try {
      const claimStat = await stat(claimPath);
      if (Date.now() - claimStat.mtimeMs > STALE_RECLAIM_CLAIM_MS) {
        await rm(claimPath, { recursive: true, force: true });
      }
    } catch {
      // Already gone or unreadable — nothing to clean.
    }
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
  await sweepStaleReclaimClaims(dir);
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
