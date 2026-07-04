import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CliConfig = {
  backendUrl: string;
  sessions: Record<string, string>;
  wallets: Record<string, { address?: string }>;
};

// @h402/cli is an end-user tool: default to the production backend. Override
// with --api-url or H402_API_URL (e.g. http://localhost:3000 for local dev).
const DEFAULT_BACKEND_URL = "https://h402.hunt.town";

function configPath() {
  return path.join(os.homedir(), ".h402", "config.json");
}

function defaultConfig(): CliConfig {
  return { backendUrl: process.env.H402_API_URL ?? DEFAULT_BACKEND_URL, sessions: {}, wallets: {} };
}

async function tightenConfigPermissions(file: string) {
  await Promise.all([chmod(path.dirname(file), 0o700).catch(() => undefined), chmod(file, 0o600).catch(() => undefined)]);
}

export async function loadConfig(): Promise<CliConfig> {
  const file = configPath();
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
    await tightenConfigPermissions(file);
  } catch (error) {
    // A missing file is a normal first run. Any other read error (permissions,
    // I/O) must surface, not be masked by silently starting from defaults.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig();
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
  const config = parsed as Record<string, unknown>;
  const defaults = defaultConfig();
  return {
    backendUrl: typeof config.backendUrl === "string" ? config.backendUrl : defaults.backendUrl,
    sessions: isPlainObject(config.sessions) ? (config.sessions as Record<string, string>) : {},
    wallets: isPlainObject(config.wallets) ? (config.wallets as CliConfig["wallets"]) : {}
  };
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function saveConfig(config: CliConfig) {
  const file = configPath();
  const dir = path.dirname(file);
  // The config holds session tokens and wallet mappings — keep it user-private.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  // mkdir/writeFile modes are umask-masked and the file mode only applies on
  // create, so tighten existing dir/file too. Best-effort: a no-op on platforms
  // without POSIX permissions.
  await tightenConfigPermissions(file);
}

export function backendUrl(config: CliConfig, apiUrlFlag?: string) {
  return (apiUrlFlag ?? process.env.H402_API_URL ?? config.backendUrl ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}
