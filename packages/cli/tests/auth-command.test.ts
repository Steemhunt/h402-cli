import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig } from "../src/config";
import type { ParsedArgs } from "../src/utils";

const { saveConfig, signOwsMessage, ADDR } = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  signOwsMessage: vi.fn(async () => "0xsigned"),
  ADDR: "0x1111111111111111111111111111111111111111"
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(async (): Promise<CliConfig> => ({
    backendUrl: "https://test.example",
    sessions: {},
    wallets: { h402: { address: ADDR } }
  })),
  saveConfig,
  backendUrl: () => "https://test.example"
}));

vi.mock("../src/ows.js", () => ({
  createOwsWallet: vi.fn(),
  runOwsCli: vi.fn(),
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
    saveConfig.mockClear();
    signOwsMessage.mockClear();
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

    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ sessions: { "https://test.example": "secret-token" } }));
    const calls = stdout.mock.calls as unknown[][];
    const written = calls.map((call) => String(call[0])).join("");
    expect(written).toContain(ADDR);
    expect(written).toContain("expiresAt");
    expect(written).not.toContain("secret-token");
    expect(JSON.parse(written)).toEqual({ session: { address: ADDR, expiresAt: "2026-07-05T00:00:00.000Z" } });
  });
});
