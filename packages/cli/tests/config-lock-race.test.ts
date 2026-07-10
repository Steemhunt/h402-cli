import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: fsMock.readFile };
});

const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const { acquireConfigLock } = await import("../src/config-lock");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function deadOwner(token: string) {
  const child = spawn(process.execPath, ["--version"], { stdio: "ignore" });
  const pid = child.pid as number;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return { version: 3, pid, hostname: os.hostname(), createdAt: new Date().toISOString(), token };
}

describe("config lock reclamation ordering", () => {
  const roots: string[] = [];

  afterEach(async () => {
    fsMock.readFile.mockReset();
    await Promise.all(roots.splice(0).map((root) => actualFs.rm(root, { recursive: true, force: true })));
  });

  it("does not let a stale reclaimer displace a live successor and admit a third writer", async () => {
    const root = await actualFs.mkdtemp(path.join(os.tmpdir(), "h402-lock-race-"));
    roots.push(root);
    const dir = path.join(root, ".h402");
    const lockDir = path.join(dir, ".config.lock");
    const retiredDeadLock = path.join(dir, ".config.lock.retired-dead-owner");
    const ownerFile = path.join(lockDir, "owner.json");
    await actualFs.mkdir(lockDir, { recursive: true });
    await actualFs.writeFile(ownerFile, JSON.stringify(await deadOwner("dead-a")));

    const firstOwnerRead = deferred();
    const allowFirstOwnerRead = deferred();
    const secondOwnerRead = deferred();
    const allowSecondOwnerRead = deferred();
    let ownerReads = 0;
    fsMock.readFile.mockImplementation(async (file: string, encoding: BufferEncoding) => {
      const value = await actualFs.readFile(file, encoding);
      if (path.basename(file) === "owner.json") {
        ownerReads += 1;
        if (ownerReads === 1) {
          firstOwnerRead.resolve();
          await allowFirstOwnerRead.promise;
        } else if (ownerReads === 2) {
          secondOwnerRead.resolve();
          await allowSecondOwnerRead.promise;
        }
      }
      return value;
    });

    const staleReclaimer = acquireConfigLock(dir).then(async (release) => release());
    await firstOwnerRead.promise;

    // Simulate the first reclaimer retiring dead A, then let live successor B
    // acquire the canonical lock path while R2 still holds its stale A observation.
    await actualFs.rename(lockDir, retiredDeadLock);
    const releaseSuccessor = await acquireConfigLock(dir);
    allowFirstOwnerRead.resolve();
    await secondOwnerRead.promise;

    let thirdWriterEntered = false;
    const allowThirdWriterRelease = deferred();
    const thirdWriter = acquireConfigLock(dir).then(async (release) => {
      thirdWriterEntered = true;
      await allowThirdWriterRelease.promise;
      await release();
    });

    await delay(75);
    const overlappedSuccessor = thirdWriterEntered;

    allowSecondOwnerRead.resolve();
    allowThirdWriterRelease.resolve();
    const successorRelease = await releaseSuccessor().then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );
    const contenderResults = await Promise.allSettled([staleReclaimer, thirdWriter]);

    expect(overlappedSuccessor).toBe(false);
    expect(successorRelease).toEqual({ ok: true });
    expect(contenderResults.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  }, 15_000);
});
