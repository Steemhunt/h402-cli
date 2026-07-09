import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig } from "../src/config";
import type { ParsedArgs } from "../src/utils";

const { loadConfig, updateConfig, signOwsMessage, updatedConfigs, ADDR } = vi.hoisted(() => {
  const ADDR = "0x1111111111111111111111111111111111111111";
  const updatedConfigs: CliConfig[] = [];
  const config = (): CliConfig => ({
    backendUrl: "https://test.example",
    sessions: {},
    wallets: { h402: { address: ADDR } }
  });
  const loadConfig = vi.fn(async () => config());
  const updateConfig = vi.fn(async (update: (config: CliConfig) => void | CliConfig | Promise<void | CliConfig>) => {
    const draft = config();
    const next = (await update(draft)) ?? draft;
    updatedConfigs.push(next);
    return next;
  });

  return {
    loadConfig,
    updateConfig,
    signOwsMessage: vi.fn(async () => "0xsigned"),
    updatedConfigs,
    ADDR
  };
});

vi.mock("../src/config.js", () => ({
  loadConfig,
  updateConfig,
  backendUrl: () => "https://test.example"
}));

vi.mock("../src/ows.js", () => ({
  createOwsWallet: vi.fn(),
  getOwsWallet: vi.fn(async () => ({ name: "h402", address: ADDR })),
  listOwsWallets: vi.fn(async () => []),
  signOwsMessage,
  signOwsTypedData: vi.fn()
}));

const { authCommand } = await import("../src/commands");

function args(): ParsedArgs {
  return { positional: ["auth"], flags: {} };
}

function jsonResponse(body: unknown) {
  return {
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    text: async () => JSON.stringify(body)
  };
}

describe("authCommand", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loadConfig.mockClear();
    updateConfig.mockClear();
    signOwsMessage.mockClear();
    updatedConfigs.length = 0;
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ challenge: { message: "sign me" } }))
        .mockResolvedValueOnce(jsonResponse({ session: { token: "secret-token", address: ADDR, expiresAt: "2026-07-05T00:00:00.000Z" } }))
    );
  });

  afterEach(() => {
    stdout.mockRestore();
    vi.unstubAllGlobals();
  });

  it("persists but does not print the bearer token", async () => {
    await authCommand(args());

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updatedConfigs[0]).toEqual(expect.objectContaining({ sessions: { "https://test.example": "secret-token" } }));
    const calls = stdout.mock.calls as unknown[][];
    const written = calls.map((call) => String(call[0])).join("");
    expect(written).toContain(ADDR);
    expect(written).toContain("expiresAt");
    expect(written).not.toContain("secret-token");
    expect(JSON.parse(written)).toEqual({ session: { address: ADDR, expiresAt: "2026-07-05T00:00:00.000Z" } });
  });
});
