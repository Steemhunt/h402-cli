import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deadOwner } from "./helpers";

vi.mock("fs-native-extensions", () => {
  throw Object.assign(new Error("native addon unavailable"), { code: "ERR_DLOPEN_FAILED" });
});

const { acquireConfigLock } = await import("../src/config-lock");

describe("config lock reclamation guard loading", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("preserves a dead-owner lock with manual guidance when the native guard cannot load", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "h402-lock-guard-import-"));
    roots.push(root);
    const dir = path.join(root, ".h402");
    const lockDir = path.join(dir, ".config.lock");
    await mkdir(dir, { recursive: true });

    const release = await acquireConfigLock(dir);
    await release();

    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadOwner("dead-import-failure")));

    await expect(acquireConfigLock(dir)).rejects.toThrow(/reclamation guard.*remove this lock path/i);
    await expect(stat(lockDir)).resolves.toBeDefined();
  }, 10_000);
});
