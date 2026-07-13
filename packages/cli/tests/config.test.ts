import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backendUrl, loadConfig, saveConfig, updateConfig, type CliConfig } from "../src/config";

const PROD_URL = "https://h402.hunt.town";

function configWith(backend?: string): CliConfig {
  return { backendUrl: backend as string, sessions: {}, wallets: {} };
}

// A same-host owner whose PID is proven dead: spawn a real child, let it exit,
// and record its now-free PID. Works on every supported platform.
async function deadOwner(token: string) {
  const child = spawn(process.execPath, ["--version"], { stdio: "ignore" });
  const pid = child.pid as number;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return { version: 3, pid, hostname: os.hostname(), createdAt: new Date().toISOString(), token };
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

  it("reclaims a config lock owned by a dead process", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadOwner("dead-owner")));

    await saveConfig({ backendUrl: PROD_URL, sessions: { [PROD_URL]: "recovered" }, wallets: {} });

    await expect(loadConfig()).resolves.toMatchObject({ sessions: { [PROD_URL]: "recovered" } });
    await expect(stat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
    const guardStat = await stat(path.join(path.dirname(lockDir), ".config.lock.guard"));
    expect(guardStat.isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(guardStat.mode & 0o777).toBe(0o600);
    }
  }, 10_000);

  it("serializes simultaneous writers while reclaiming the same dead-owner lock", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadOwner("dead-race")));

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
    await expect(stat(path.join(path.dirname(lockDir), ".config.lock.guard"))).resolves.toBeDefined();
  });

  // The exact #72 failure on every supported platform: a real lock holder is
  // SIGKILLed (finally never runs), and the next writer must recover on its own.
  it("recovers after a lock-holding process is hard-killed", async () => {
    const dir = path.join(home, ".h402");
    await mkdir(dir, { recursive: true });
    const lockDir = path.join(dir, ".config.lock");
    const code = `
      import { acquireConfigLock } from "./packages/cli/src/config-lock.ts";
      await acquireConfigLock(${JSON.stringify(dir)});
      console.log("LOCKED");
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
        const timer = setTimeout(() => reject(new Error(`lock holder did not start: ${stderr}`)), 10_000);
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("LOCKED")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`lock holder exited early with ${code}: ${stderr}`)));
      });
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await exited;
    await expect(stat(lockDir)).resolves.toBeDefined();

    const recoveredUrl = "https://after-crash.example";
    await saveConfig({ backendUrl: recoveredUrl, sessions: {}, wallets: {} });
    expect((await loadConfig()).backendUrl).toBe(recoveredUrl);
    await expect(stat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);

  it.skipIf(process.platform === "win32")("recovers after a reclamation-guard holder is hard-killed", async () => {
    const dir = path.join(home, ".h402");
    const lockDir = path.join(dir, ".config.lock");
    const guardPath = path.join(dir, ".config.lock.guard");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(await deadOwner("dead-before-guard-crash")));

    const code = `
      import { open } from "node:fs/promises";
      import { tryLock } from "fs-native-extensions";
      const handle = await open(${JSON.stringify(guardPath)}, "a+");
      if (!tryLock(handle.fd)) throw new Error("failed to acquire reclamation guard");
      console.log("GUARD_LOCKED");
      setInterval(() => {}, 1_000);
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`guard holder did not start: ${stderr}`)), 10_000);
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
    let saveSettled = false;
    const recoveredUrl = "https://after-guard-crash.example";
    const saving = saveConfig({ backendUrl: recoveredUrl, sessions: {}, wallets: {} }).finally(() => {
      saveSettled = true;
    });
    await delay(75);
    const saveWasBlocked = !saveSettled;

    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const killed = child.kill("SIGKILL");
    await exited;
    await saving;

    expect(saveWasBlocked).toBe(true);
    expect(killed).toBe(true);
    expect((await loadConfig()).backendUrl).toBe(recoveredUrl);
    await expect(stat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);

  it("does not reclaim an ownerless legacy lock based on age alone", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });

    await expect(saveConfig({ backendUrl: PROD_URL, sessions: {}, wallets: { recovered: { address: "0xabc" } } })).rejects.toThrow(
      /lock has no valid owner metadata.*If no h402 process is writing config, remove this lock path and retry/
    );

    await expect(stat(lockDir)).resolves.toBeDefined();
    await expect(stat(configFile)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);

  it("does not reclaim an owner recorded on a different host", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });
    const owner = { ...(await deadOwner("remote-owner")), hostname: "some-other-host" };
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner));

    await expect(saveConfig({ backendUrl: PROD_URL, sessions: {}, wallets: {} })).rejects.toThrow(
      /cannot be verified from this host.*If no h402 process is writing config, remove this lock path and retry/
    );
    await expect(stat(lockDir)).resolves.toBeDefined();
  }, 10_000);

  it("does not reclaim a lock whose recorded PID is alive", async () => {
    const lockDir = path.join(home, ".h402", ".config.lock");
    await mkdir(lockDir, { recursive: true });
    // A live same-host PID that is not this writer: liveness must win over any
    // other signal, so the contender times out instead of deleting the lock.
    const owner = { version: 3, pid: process.pid, hostname: os.hostname(), createdAt: new Date().toISOString(), token: "someone-else" };
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner));

    await expect(saveConfig({ backendUrl: PROD_URL, sessions: {}, wallets: {} })).rejects.toThrow(/live PID/);
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
    expect(owner).toEqual({
      version: 3,
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: expect.any(String),
      token: expect.any(String)
    });
    expect(Number.isFinite(Date.parse(owner.createdAt))).toBe(true);

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
