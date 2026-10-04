import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig } from "../src/config";
import type { ParsedArgs } from "../src/utils";
import { configMockFactory, owsMockFactory } from "./helpers";

const { loadConfig, updateConfig, getOwsWallet, signOwsMessage, updatedConfigs, ADDR } = vi.hoisted(() => {
  const ADDR = "0x1111111111111111111111111111111111111111";
  const updatedConfigs: CliConfig[] = [];
  const config = (): CliConfig => ({
    backendUrl: "https://test.example",
    sessions: {}
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
    getOwsWallet: vi.fn(),
    signOwsMessage: vi.fn(async () => "0xsigned"),
    updatedConfigs,
    ADDR
  };
});

vi.mock("../src/config.js", () => configMockFactory({ loadConfig, updateConfig, backendUrl: "https://test.example" }));
vi.mock("../src/ows.js", () =>
  owsMockFactory({
    getOwsWallet,
    listOwsWallets: vi.fn(async () => []),
    signOwsMessage
  })
);

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
    getOwsWallet.mockReset().mockImplementation(async (name: string) => ({ name, address: ADDR }));
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
    const written = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(written).not.toContain("secret-token");
    expect(JSON.parse(written)).toEqual({ session: { address: ADDR, expiresAt: "2026-07-05T00:00:00.000Z" } });
  });

  it("signs authentication with the configured default wallet", async () => {
    loadConfig.mockResolvedValueOnce({
      backendUrl: "https://test.example",
      sessions: {},
      defaultWallet: "agent"
    });

    await authCommand(args());

    expect(signOwsMessage).toHaveBeenCalledWith("agent", "sign me", undefined);
  });

  it("authenticates the current native address for a recreated wallet name", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    getOwsWallet.mockResolvedValueOnce({ name: "h402", address });
    await authCommand(args());
    expect(globalThis.fetch).toHaveBeenCalledWith("https://test.example/api/auth/challenge", expect.objectContaining({ body: JSON.stringify({ address }) }));
    expect(globalThis.fetch).toHaveBeenCalledWith("https://test.example/api/auth/verify", expect.objectContaining({ body: JSON.stringify({ address, message: "sign me", signature: "0xsigned" }) }));
  });

  it.each(["wallet not found", "native bindings unavailable", "permission denied"])("stops authentication on %s before signing or making requests", async (message) => {
    getOwsWallet.mockRejectedValueOnce(new Error(message));
    await expect(authCommand(args())).rejects.toThrow(message);
    expect(signOwsMessage).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
