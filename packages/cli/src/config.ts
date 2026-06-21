import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export async function loadConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as CliConfig;
  } catch {
    return { backendUrl: process.env.H402_API_URL ?? DEFAULT_BACKEND_URL, sessions: {}, wallets: {} };
  }
}

export async function saveConfig(config: CliConfig) {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2));
}

export function backendUrl(config: CliConfig, apiUrlFlag?: string) {
  return (apiUrlFlag ?? process.env.H402_API_URL ?? config.backendUrl ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}
