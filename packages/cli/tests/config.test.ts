import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backendUrl, loadConfig, saveConfig, updateConfig, type CliConfig } from "../src/config";

const PROD_URL = "https://h402.hunt.town";

function configWith(backend?: string): CliConfig {
  return { backendUrl: backend as string, sessions: {}, wallets: {} };
}

async function deadLocalLockOwner(token: string) {
  const [machineId, bootId, pidNamespace] = await Promise.all([
    readFile("/etc/machine-id", "utf8"),
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    readlink("/proc/self/ns/pid")
  ]);
  const machineIdHash = createHash("sha256").update("h402-config-lock\0").update(machineId.trim()).digest("hex");
  return {
    version: 2,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: new Date(0).toISOString(),
    token,
    linuxProcess: {
      machineIdHash,
      bootId: bootId.trim(),
      pidNamespace: pidNamespace.trim(),
      // The current PID exists, but this impossible start time proves that the
      // recorded owner process instance is gone rather than merely reusing a PID.
      startTicks: "0"
    }
  };
}

describe("backendUrl resolution", () => {
  const savedEnv = process.env.H402_API_URL;

  beforeEach(() => {
    delete process.env.H402_API_URL;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.H402_API_URL;
    } else {
      process.env.H402_API_URL = savedEnv;
    }
  });

  it("defaults to the production backend when no flag, env, or saved config is set", () => {
    expect(backendUrl(configWith(undefined))).toBe(PROD_URL);
  });

  it("prefers a saved config URL over the default", () => {
    expect(backendUrl(configWith("https://staging.example"))).toBe("https://staging.example");
  });

  it("prefers H402_API_URL over the saved config", () => {
    process.env.H402_API_URL = "https://env.example";
    expect(backendUrl(configWith("https://staging.example"))).toBe("https://env.example");
  });

  it("prefers the --api-url flag over env and saved config", () => {
    process.env.H402_API_URL = "https://env.example";
    expect(backendUrl(configWith("https://staging.example"), "http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("strips a trailing slash from the resolved URL", () => {
    expect(backendUrl(configWith(undefined), "https://h402.hunt.town/")).toBe(PROD_URL);
  });
});

// loadConfig/saveConfig read ~/.h402/config.json via os.homedir(); redirect HOME
// to a throwaway dir so these never touch the developer's real config.
describe("loadConfig / saveConfig", () => {
  const savedHome = process.env.HOME;
  const savedApiUrl = process.env.H402_API_URL;
  let home: string;
  let configFile: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "h402-cfg-"));
    process.env.HOME = home;
    delete process.env.H402_API_URL;
    configFile = path.join(home, ".h402", "config.json");
  });

  afterEach(async () => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedApiUrl === undefined) delete process.env.H402_API_URL;
    else process.env.H402_API_URL = savedApiUrl;
    await rm(home, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists (first run)", async () => {
    await expect(loadConfig()).resolves.toEqual({ backendUrl: PROD_URL, sessions: {}, wallets: {} });
  });

  it("does not persist a one-shot H402_API_URL in the default config snapshot", async () => {
    process.env.H402_API_URL = "https://staging.example";

    await expect(loadConfig()).resolves.toEqual({ backendUrl: PROD_URL, sessions: {}, wallets: {} });
    await saveConfig(await loadConfig());

    const saved = JSON.parse(await readFile(configFile, "utf8"));
    expect(saved.backendUrl).toBe(PROD_URL);
  });

  it("round-trips a saved config", async () => {
    const config: CliConfig = {
      backendUrl: "https://staging.example",
      sessions: { "https://staging.example": "tok" },
      wallets: { h402: { address: "0xabc" } },
      maxUsd: "0.05"
    };
    await saveConfig(config);
    await expect(loadConfig()).resolves.toEqual(config);
  });

  it.skipIf(process.platform !== "linux")("reclaims a config lock owned by a dead process instance", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadLocalLockOwner("dead-owner")));

    await saveConfig({ backendUrl: PROD_URL, sessions: { [PROD_URL]: "recovered" }, wallets: {} });

    await expect(loadConfig()).resolves.toMatchObject({ sessions: { [PROD_URL]: "recovered" } });
    await expect(stat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(path.dirname(lockDir))).filter((entry) => entry.startsWith(".config.lock.reclaim-"))).toEqual([]);
  }, 10_000);

  it.skipIf(process.platform !== "linux")("serializes simultaneous writers while reclaiming the same dead-owner lock", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadLocalLockOwner("dead-race")));

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        updateConfig((config) => {
          config.sessions[`https://writer-${index}.example`] = String(index);
        })
      )
    );

    const saved = await loadConfig();
    expect(Object.keys(saved.sessions)).toHaveLength(8);
    await expect(stat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(path.dirname(lockDir))).filter((entry) => entry.startsWith(".config.lock.reclaim-"))).toEqual([]);
  });

  it.skipIf(process.platform !== "linux")("reclaims a dead config lock after the operation-guard holder is killed", async () => {
    const dir = path.join(home, ".h402");
    const lockDir = path.join(dir, ".config.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadLocalLockOwner("interrupted-guard-owner")));
    const code = `
      import { acquireConfigLockOperationGuard } from "./packages/cli/src/config-lock.ts";
      await acquireConfigLockOperationGuard(${JSON.stringify(dir)});
      console.log("GUARD_LOCKED");
      await new Promise(() => {});
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`guard holder did not start: ${stderr}`)), 5_000);
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("GUARD_LOCKED")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`guard holder exited early with ${code}: ${stderr}`)));
      });
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await exited;

    const recoveredUrl = "https://after-guard-crash.example";
    await saveConfig({ backendUrl: recoveredUrl, sessions: {}, wallets: {} });
    expect((await loadConfig()).backendUrl).toBe(recoveredUrl);
    await expect(stat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(path.join(dir, ".config.lock.guard"))).isFile()).toBe(true);
  });

  it("does not reclaim an ownerless legacy lock based on age alone", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });

    await expect(saveConfig({ backendUrl: PROD_URL, sessions: {}, wallets: { recovered: { address: "0xabc" } } })).rejects.toThrow(
      /lock has no valid owner metadata.*If no h402 process is writing config, remove this lock path and retry/
    );

    await expect(stat(lockDir)).resolves.toBeDefined();
    await expect(stat(configFile)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);

  it.skipIf(process.platform !== "linux")("does not reclaim an owner from a different machine instance", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });
    const owner = await deadLocalLockOwner("remote-owner");
    owner.linuxProcess.machineIdHash = "different-machine-instance";
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner));

    await expect(saveConfig({ backendUrl: PROD_URL, sessions: {}, wallets: {} })).rejects.toThrow(
      /different machine instance.*If no h402 process is writing config, remove this lock path and retry/
    );
    await expect(stat(lockDir)).resolves.toBeDefined();
  }, 10_000);

  it("waits for a live competing writer and preserves serialized updates", async () => {
    let enteredFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      enteredFirst = resolve;
    });
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = updateConfig(async (config) => {
      config.sessions["https://one.example"] = "one";
      enteredFirst();
      await firstMayFinish;
    });
    await firstEntered;

    const lockDir = path.join(home, ".h402", ".config.lock");
    const owner = JSON.parse(await readFile(path.join(lockDir, "owner.json"), "utf8"));
    expect(owner).toEqual(
      expect.objectContaining({
        version: 2,
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: expect.any(String),
        token: expect.any(String)
      })
    );
    expect(Number.isFinite(Date.parse(owner.createdAt))).toBe(true);
    if (process.platform === "linux") {
      expect(owner.linuxProcess).toEqual(
        expect.objectContaining({ machineIdHash: expect.any(String), bootId: expect.any(String), pidNamespace: expect.any(String), startTicks: expect.any(String) })
      );
    }

    let secondEntered = false;
    const second = updateConfig((config) => {
      secondEntered = true;
      config.sessions["https://two.example"] = "two";
    });
    await delay(75);
    expect(secondEntered).toBe(false);

    releaseFirst();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
    await expect(loadConfig()).resolves.toMatchObject({
      sessions: { "https://one.example": "one", "https://two.example": "two" }
    });
  });

  it("does not remove a successor lock when ownership changes before release", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    const ownerFile = path.join(lockDir, "owner.json");

    await expect(
      updateConfig(async (config) => {
        config.sessions[PROD_URL] = "saved";
        const owner = JSON.parse(await readFile(ownerFile, "utf8"));
        await writeFile(ownerFile, JSON.stringify({ ...owner, token: "successor-token" }));
      })
    ).rejects.toThrow(/Refusing to release h402 config lock.*ownership changed/);

    expect(JSON.parse(await readFile(ownerFile, "utf8"))).toMatchObject({ token: "successor-token" });
    await rm(lockDir, { recursive: true });
  });

  it("serializes concurrent saves and preserves independent wallet/session updates", async () => {
    await Promise.all([
      saveConfig({ backendUrl: PROD_URL, sessions: { "https://one.example": "one" }, wallets: { one: { address: "0x111" } } }),
      saveConfig({ backendUrl: PROD_URL, sessions: { "https://two.example": "two" }, wallets: { two: { address: "0x222" } } })
    ]);

    await expect(loadConfig()).resolves.toEqual({
      backendUrl: PROD_URL,
      sessions: { "https://one.example": "one", "https://two.example": "two" },
      wallets: { one: { address: "0x111" }, two: { address: "0x222" } }
    });
  });

  it("does not let a stale full-snapshot save roll back newer wallet/session values", async () => {
    const stale: CliConfig = {
      backendUrl: PROD_URL,
      sessions: { "https://api.example": "old" },
      wallets: { agent: { address: "0x111" } }
    };

    await saveConfig({ backendUrl: PROD_URL, sessions: { "https://api.example": "new" }, wallets: {} });
    await saveConfig(stale);

    await expect(loadConfig()).resolves.toEqual({
      backendUrl: PROD_URL,
      sessions: { "https://api.example": "new" },
      wallets: { agent: { address: "0x111" } }
    });
  });

  it("throws on malformed JSON and does not overwrite it", async () => {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, "{ not valid json");
    await expect(loadConfig()).rejects.toThrow(/not a valid config object/);
    // The malformed file must be left intact, not silently reset.
    expect(await readFile(configFile, "utf8")).toBe("{ not valid json");
  });

  it("throws on a non-object config (valid JSON, wrong shape)", async () => {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, "[1, 2, 3]");
    await expect(loadConfig()).rejects.toThrow(/not a valid config object/);
  });

  it("normalizes a sparse or mistyped config object so commands don't crash later", async () => {
    await mkdir(path.dirname(configFile), { recursive: true });
    // Empty object: every field defaults.
    await writeFile(configFile, "{}");
    await expect(loadConfig()).resolves.toEqual({ backendUrl: PROD_URL, sessions: {}, wallets: {} });
    // Mistyped sessions/wallets and backendUrl fall back to safe defaults.
    await writeFile(configFile, JSON.stringify({ backendUrl: 5, sessions: "nope", wallets: [] }));
    await expect(loadConfig()).resolves.toEqual({ backendUrl: PROD_URL, sessions: {}, wallets: {} });
  });

  it("keeps valid sessions/wallets while defaulting a missing field", async () => {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, JSON.stringify({ wallets: { h402: { address: "0xabc" } } }));
    await expect(loadConfig()).resolves.toEqual({ backendUrl: PROD_URL, sessions: {}, wallets: { h402: { address: "0xabc" } } });
  });

  it.skipIf(process.platform === "win32")("tightens pre-existing config permissions during load", async () => {
    await mkdir(path.dirname(configFile), { recursive: true, mode: 0o755 });
    await writeFile(configFile, JSON.stringify({ backendUrl: PROD_URL, sessions: { [PROD_URL]: "tok" }, wallets: {} }), { mode: 0o644 });
    await chmod(path.dirname(configFile), 0o755);
    await chmod(configFile, 0o644);

    await expect(loadConfig()).resolves.toMatchObject({ sessions: { [PROD_URL]: "tok" } });
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(configFile))).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")("writes config and directory with private permissions", async () => {
    await saveConfig({ backendUrl: PROD_URL, sessions: {}, wallets: {} });
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(configFile))).mode & 0o777).toBe(0o700);
  });
});
