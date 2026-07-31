import { spawn } from "node:child_process";
import os from "node:os";
import { vi } from "vitest";

export const ADDR = "0x1111111111111111111111111111111111111111";
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const statusText = new Response(null, { status }).statusText;
  return {
    status,
    statusText,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    headers: new Headers(headers)
  };
}

export function printed(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(spy.mock.calls.map((call) => String(call[0])).join(""));
}

export function configMockFactory(mocks: { loadConfig: unknown; updateConfig?: unknown }) {
  return {
    loadConfig: mocks.loadConfig,
    updateConfig: mocks.updateConfig ?? vi.fn(),
    backendUrl: (config: { backendUrl: string }, apiUrlFlag?: string) =>
      (apiUrlFlag ?? process.env.H402_API_URL ?? config.backendUrl).replace(/\/$/, "")
  };
}

export function owsMockFactory(overrides: Record<string, unknown> = {}) {
  return {
    createOwsWallet: vi.fn(),
    getOwsWallet: vi.fn(),
    listOwsWallets: vi.fn(),
    signOwsMessage: vi.fn(),
    signOwsTypedData: vi.fn(),
    ...overrides
  };
}

// A same-host owner whose PID is proven dead: spawn a real child, let it exit,
// and record its now-free PID. Works on every supported platform.
export async function deadOwner(token: string) {
  const child = spawn(process.execPath, ["--version"], { stdio: "ignore" });
  const pid = child.pid as number;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return { version: 3, pid, hostname: os.hostname(), createdAt: new Date().toISOString(), token };
}
