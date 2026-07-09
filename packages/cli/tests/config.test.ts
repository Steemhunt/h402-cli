import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backendUrl, loadConfig, saveConfig, type CliConfig } from "../src/config";

const PROD_URL = "https://h402.hunt.town";

function configWith(backend?: string): CliConfig {
  return { backendUrl: backend as string, sessions: {}, wallets: {} };
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
