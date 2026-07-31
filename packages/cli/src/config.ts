import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireConfigLock } from "./config-lock.js";

export type CliConfig = {
  backendUrl: string;
  sessions: Record<string, string>;
  wallets: Record<string, { address?: string }>;
  maxUsd?: string;
};

// @h402/cli is an end-user tool: default to the production backend. Override
// with --api-url or H402_API_URL (e.g. http://localhost:3000 for local dev).
const DEFAULT_BACKEND_URL = "https://h402.hunt.town";

function configPath() {
  return path.join(os.homedir(), ".h402", "config.json");
}

function defaultConfig(): CliConfig {
  return { backendUrl: DEFAULT_BACKEND_URL, sessions: {}, wallets: {} };
}

function normalizeConfig(parsed: Record<string, unknown>): CliConfig {
  const defaults = defaultConfig();
  const normalized: CliConfig = {
    backendUrl: typeof parsed.backendUrl === "string" ? parsed.backendUrl : defaults.backendUrl,
    sessions: isPlainObject(parsed.sessions) ? (parsed.sessions as Record<string, string>) : {},
    wallets: isPlainObject(parsed.wallets) ? (parsed.wallets as CliConfig["wallets"]) : {}
  };
  if (typeof parsed.maxUsd === "string") {
    normalized.maxUsd = parsed.maxUsd;
  }
  return normalized;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function tightenConfigPermissions(file: string) {
  await Promise.all([chmod(path.dirname(file), 0o700).catch(() => undefined), chmod(file, 0o600).catch(() => undefined)]);
}

async function readConfigFile(file: string): Promise<CliConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
    await tightenConfigPermissions(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Could not read h402 config at ${file}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  // Surface malformed config instead of overwriting it and losing the session
  // tokens and wallet mappings it holds.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`h402 config at ${file} is not a valid config object. Fix or remove it (it holds your session tokens and known wallets).`);
  }
  // Normalize to the CliConfig shape so a sparse or partial file (e.g. `{}` or a
  // missing/mistyped sessions/wallets key) yields a usable config instead of
  // crashing later when a command reads config.sessions / config.wallets.
  return normalizeConfig(parsed as Record<string, unknown>);
}

export async function loadConfig(): Promise<CliConfig> {
  return (await readConfigFile(configPath())) ?? defaultConfig();
}

function cloneConfig(config: CliConfig): CliConfig {
  const cloned: CliConfig = {
    backendUrl: config.backendUrl,
    sessions: { ...config.sessions },
    wallets: Object.fromEntries(Object.entries(config.wallets).map(([name, wallet]) => [name, { ...wallet }]))
  };
  if (config.maxUsd !== undefined) {
    cloned.maxUsd = config.maxUsd;
  }
  return cloned;
}

async function atomicWritePrivateJson(file: string, config: CliConfig) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
    await chmod(tmp, 0o600).catch(() => undefined);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function updateConfig(update: (config: CliConfig) => void | CliConfig | Promise<void | CliConfig>) {
  const file = configPath();
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireConfigLock(dir);
  let next: CliConfig;
  try {
    const current = (await readConfigFile(file)) ?? defaultConfig();
    const draft = cloneConfig(current);
    next = (await update(draft)) ?? draft;
    await atomicWritePrivateJson(file, next);
  } finally {
    await releaseLock();
  }
  await tightenConfigPermissions(file);
  return next;
}

export function backendUrl(config: CliConfig, apiUrlFlag?: string) {
  return (apiUrlFlag ?? process.env.H402_API_URL ?? config.backendUrl ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}
