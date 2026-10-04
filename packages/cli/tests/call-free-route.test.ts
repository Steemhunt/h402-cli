import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/utils";
import { ADDR, BASE_USDC, configMockFactory, owsMockFactory, res } from "./helpers";

const { loadConfig, updateConfig, getOwsWallet, listOwsWallets } = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  updateConfig: vi.fn(),
  getOwsWallet: vi.fn(),
  listOwsWallets: vi.fn()
}));

vi.mock("../src/config.js", () => configMockFactory({ loadConfig, updateConfig, backendUrl: "https://test.example" }));
vi.mock("../src/ows.js", () => owsMockFactory({ getOwsWallet, listOwsWallets }));

const { callCommand } = await import("../src/commands");

function args(flags: ParsedArgs["flags"] = {}): ParsedArgs {
  return { positional: ["call", "ai/image-generate-async-status"], flags: { provider: "stablestudio-image", ...flags } };
}

describe("callCommand free routes", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    loadConfig.mockResolvedValue({ backendUrl: "https://test.example", sessions: {} });
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
    loadConfig.mockResolvedValue({ backendUrl: "https://test.example", sessions: {}, defaultWallet: "missing" });
    const fetch = vi.fn(async () => res(200, { status: "complete" }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(args({ query: '{"jobId":"job_123"}' }));

    expect(fetch).toHaveBeenCalledWith(
      "https://test.example/routes/stablestudio-image/ai/image-generate-async-status?jobId=job_123",
      expect.objectContaining({ method: "GET" })
    );
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("complete"));
    expect(getOwsWallet).not.toHaveBeenCalled();
  });

  it.each(["network", "response body"])("warns about a possible credit charge after a lost %s response", async (stage) => {
    loadConfig.mockResolvedValue({ backendUrl: "https://test.example", sessions: { "https://test.example": "test-token" } });
    const failure = new Error("connection lost");
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (stage === "network") throw failure;
      return { ...res(200, {}), text: async () => { throw failure; } };
    }));

    await expect(callCommand(args({ "idempotency-key": "original-key" }))).rejects.toMatchObject({
      message: expect.stringContaining("do NOT sign or pay with a new idempotency key"),
      detail: { idempotencyKey: "original-key" }
    });
    expect(getOwsWallet).not.toHaveBeenCalled();
  });

  it.each([{}, { "no-credit": true }])("does not add credit-charge guidance when the initial request has no bearer token: %j", async (flags) => {
    loadConfig.mockResolvedValue({ backendUrl: "https://test.example", sessions: flags["no-credit"] ? { "https://test.example": "test-token" } : {} });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection lost"); }));

    const error = await callCommand(args(flags)).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("do NOT sign or pay");
  });

  it("still requires a local wallet once the first response asks for payment", async () => {
    const challenge = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", asset: BASE_USDC, amount: "1", payTo: ADDR, maxTimeoutSeconds: 60 }] };
    const fetch = vi.fn(async () => res(402, challenge));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      message: expect.stringMatching(/wallet not found/),
      detail: {
        h402: {
          cliProviderSelection: {
            source: "explicit",
            provider: "stablestudio-image",
            pinnedCommand:
              "h402 call ai/image-generate-async-status --provider stablestudio-image --api-url https://test.example"
          }
        }
      }
    });
    expect(fetch).toHaveBeenCalled();
  });
});
