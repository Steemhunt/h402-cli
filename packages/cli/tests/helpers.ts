import { spawn } from "node:child_process";
import os from "node:os";
import { vi } from "vitest";

export const ADDR = "0x1111111111111111111111111111111111111111";
export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

export function res(status: number, body: unknown, headers: Record<string, string> = {}, statusText?: string) {
  return {
    status,
    ...(statusText === undefined ? {} : { statusText }),
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    headers: new Headers(headers)
  };
}

export function printed(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(spy.mock.calls.map((call) => String(call[0])).join(""));
}

export function configMockFactory(mocks: { loadConfig: unknown; updateConfig?: unknown; backendUrl: string }) {
  return {
    loadConfig: mocks.loadConfig,
    updateConfig: mocks.updateConfig ?? vi.fn(),
    backendUrl: () => mocks.backendUrl
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
