import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig } from "../src/config";
import type { ParsedArgs } from "../src/utils";

const ADDR = "0x1111111111111111111111111111111111111111";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const { loadConfig, signOwsTypedData } = vi.hoisted(() => {
  const signature = `0x${"11".repeat(65)}` as `0x${string}`;
  return {
    loadConfig: vi.fn(),
    signOwsTypedData: vi.fn(async () => signature)
  };
});

vi.mock("../src/config.js", () => ({
  loadConfig,
  saveConfig: vi.fn(),
  backendUrl: () => "https://test.example"
}));

vi.mock("../src/ows.js", () => ({
  createOwsWallet: vi.fn(),
  runOwsCli: vi.fn(),
  signOwsMessage: vi.fn(),
  signOwsTypedData
}));

const { callCommand } = await import("../src/commands");

function config(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    backendUrl: "https://test.example",
    sessions: {},
    wallets: { h402: { address: ADDR } },
    ...overrides
  };
}

function args(flags: ParsedArgs["flags"] = {}): ParsedArgs {
  return { positional: ["call", "web/search"], flags };
}

function challenge(amount: unknown) {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: BASE_USDC,
        amount,
        payTo: ADDR,
        maxTimeoutSeconds: 60
      }
    ]
  };
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { status, text: async () => JSON.stringify(body), headers: new Headers(headers) };
}

describe("callCommand --max-usd", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    loadConfig.mockResolvedValue(config());
  });

  afterEach(() => {
    stdout.mockRestore();
    vi.unstubAllGlobals();
    loadConfig.mockReset();
    signOwsTypedData.mockClear();
  });

  it("allows an amount at the cap and prints the signed amount receipt", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("50000")))
      .mockResolvedValueOnce(res(200, { data: { ok: true }, h402: { provider: "demo", paymentTransaction: "0xabc" } }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(args({ "max-usd": "0.05" }));

    expect(signOwsTypedData).toHaveBeenCalled();
    const printed = JSON.parse(stdout.mock.calls.map((call) => String(call[0])).join(""));
    expect(printed.h402).toMatchObject({
      provider: "demo",
      paymentTransaction: "0xabc",
      signedAmount: { amount: "50000", asset: "USDC", decimals: 6, usd: "0.05" }
    });
  });

  it("prints the signed amount receipt even without a cap", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("1234567")))
      .mockResolvedValueOnce(res(200, { data: { ok: true }, h402: { provider: "demo" } }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(args());

    const printed = JSON.parse(stdout.mock.calls.map((call) => String(call[0])).join(""));
    expect(printed.h402.signedAmount).toEqual({ amount: "1234567", asset: "USDC", decimals: 6, usd: "1.234567" });
  });

  it.each(["0x1234", 50000, ["50000"]])("refuses malformed x402 amount %s before signing", async (amount) => {
    const fetch = vi.fn().mockResolvedValueOnce(res(402, challenge(amount)));
    vi.stubGlobal("fetch", fetch);

    await expect(callCommand(args())).rejects.toThrow(/x402 payment amount must be an unsigned integer amount in USDC micros/);
    expect(signOwsTypedData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses to sign when the quoted amount exceeds --max-usd", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(res(402, challenge("50000")));
    vi.stubGlobal("fetch", fetch);

    await expect(callCommand(args({ "max-usd": "0.049999" }))).rejects.toThrow(/exceeds --max-usd 0.049999/);
    expect(signOwsTypedData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses config.maxUsd when --max-usd is omitted", async () => {
    loadConfig.mockResolvedValue(config({ maxUsd: "0.01" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(res(402, challenge("50000"))));

    await expect(callCommand(args())).rejects.toThrow(/exceeds --max-usd 0.01/);
  });

  it("lets --max-usd override config.maxUsd", async () => {
    loadConfig.mockResolvedValue(config({ maxUsd: "0.01" }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("50000")))
      .mockResolvedValueOnce(res(200, { data: { ok: true }, h402: { provider: "demo" } }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(args({ "max-usd": "0.05" }));

    expect(signOwsTypedData).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects --max-usd without a value", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(res(402, challenge("50000")));
    vi.stubGlobal("fetch", fetch);

    await expect(callCommand(args({ "max-usd": true }))).rejects.toThrow(/Flag --max-usd requires a USD amount/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed caps before signing or sending a request", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(res(402, challenge("50000")));
    vi.stubGlobal("fetch", fetch);

    await expect(callCommand(args({ "max-usd": "0.0000001" }))).rejects.toThrow(/at most 6 decimal places/);
    expect(signOwsTypedData).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
