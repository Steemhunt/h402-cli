import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const nativeLock = vi.hoisted(() => ({
  tryLock: vi.fn(() => {
    throw Object.assign(new Error("locking backend unavailable"), { code: "ENOTSUP" });
  }),
  unlock: vi.fn()
}));

vi.mock("fs-native-extensions", () => nativeLock);

const { acquireConfigLock } = await import("../src/config-lock");

async function deadOwner(token: string) {
  const child = spawn(process.execPath, ["--version"], { stdio: "ignore" });
  const pid = child.pid as number;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return { version: 3, pid, hostname: os.hostname(), createdAt: new Date().toISOString(), token };
}

describe("config lock reclamation guard failures", () => {
  const roots: string[] = [];

  afterEach(async () => {
    nativeLock.tryLock.mockClear();
    nativeLock.unlock.mockClear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("preserves a dead-owner lock when the native guard fails without affecting normal release", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "h402-lock-guard-failure-"));
    roots.push(root);
    const dir = path.join(root, ".h402");
    const lockDir = path.join(dir, ".config.lock");
    await mkdir(dir, { recursive: true });

    const release = await acquireConfigLock(dir);
    await release();
    expect(nativeLock.tryLock).not.toHaveBeenCalled();

    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadOwner("dead-guard-failure")));

    await expect(acquireConfigLock(dir)).rejects.toThrow(/reclamation guard.*ENOTSUP.*remove this lock path/i);
    await expect(stat(lockDir)).resolves.toBeDefined();
    expect(nativeLock.tryLock).toHaveBeenCalled();
    expect(nativeLock.unlock).not.toHaveBeenCalled();
  }, 10_000);
});
