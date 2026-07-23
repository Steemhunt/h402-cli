import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/utils";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const { loadConfig, updateConfig, getOwsWallet, listOwsWallets, ADDR } = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  updateConfig: vi.fn(),
  getOwsWallet: vi.fn(),
  listOwsWallets: vi.fn(),
  ADDR: "0x1111111111111111111111111111111111111111"
}));

vi.mock("../src/config.js", () => ({
  loadConfig,
  updateConfig,
  backendUrl: () => "https://test.example"
}));

vi.mock("../src/ows.js", () => ({
  createOwsWallet: vi.fn(),
  getOwsWallet,
  listOwsWallets,
  signOwsMessage: vi.fn(),
  signOwsTypedData: vi.fn()
}));

const { callCommand } = await import("../src/commands");

function args(flags: ParsedArgs["flags"] = {}): ParsedArgs {
  return { positional: ["call", "ai/image-generate-async-status"], flags: { provider: "stablestudio-image", ...flags } };
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { status, text: async () => (body === undefined ? "" : JSON.stringify(body)), headers: new Headers(headers) };
}

describe("callCommand free routes", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    loadConfig.mockResolvedValue({ backendUrl: "https://test.example", sessions: {}, wallets: {} });
    getOwsWallet.mockRejectedValue(new Error("wallet not found"));
    listOwsWallets.mockResolvedValue([]);
  });

  afterEach(() => {
    stdout.mockRestore();
    vi.unstubAllGlobals();
    loadConfig.mockReset();
    updateConfig.mockReset();
    getOwsWallet.mockReset();
    listOwsWallets.mockReset();
  });

  it("does not require a local wallet before a free first response", async () => {
    const fetch = vi.fn(async () => res(200, { status: "complete" }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(args({ query: '{"jobId":"job_123"}' }));

    expect(fetch).toHaveBeenCalledWith(
      "https://test.example/routes/stablestudio-image/ai/image-generate-async-status?jobId=job_123",
      expect.objectContaining({ method: "GET" })
    );
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("complete"));
  });

  it("still requires a local wallet once the first response asks for payment", async () => {
    const challenge = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", asset: BASE_USDC, amount: "1", payTo: ADDR, maxTimeoutSeconds: 60 }] };
    const fetch = vi.fn(async () => res(402, challenge));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      message: expect.stringMatching(/No address known for wallet "h402"/),
      detail: {
        h402: {
          cliProviderSelection: {
            source: "explicit",
            provider: "stablestudio-image",
            pinnedCommand: "h402 call ai/image-generate-async-status --provider stablestudio-image"
          }
        }
      }
    });
    expect(fetch).toHaveBeenCalled();
  });
});
