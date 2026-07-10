import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/utils";

const ADDR = "0x1111111111111111111111111111111111111111";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const IDEMPOTENCY_KEY = "idem-pending-43";
const REPLACEMENT_KEY = "idem-replacement-43";

const { loadConfig, signOwsTypedData } = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  signOwsTypedData: vi.fn(async () => `0x${"11".repeat(65)}` as `0x${string}`)
}));

vi.mock("../src/config.js", () => ({
  loadConfig,
  updateConfig: vi.fn(),
  backendUrl: () => "https://test.example"
}));

vi.mock("../src/ows.js", () => ({
  createOwsWallet: vi.fn(),
  getOwsWallet: vi.fn(),
  listOwsWallets: vi.fn(),
  signOwsMessage: vi.fn(),
  signOwsTypedData
}));

const { callCommand } = await import("../src/commands");

function args(flags: ParsedArgs["flags"] = {}): ParsedArgs {
  return {
    positional: ["call", "web/search"],
    flags: {
      json: '{"query":"h402"}',
      "idempotency-key": IDEMPOTENCY_KEY,
      ...flags
    }
  };
}

function challenge(amount = "1000") {
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

function pending(idempotencyKey = IDEMPOTENCY_KEY) {
  return {
    error: {
      code: "payment_settlement_pending",
      message: "Payment settlement status could not be confirmed yet; retry this idempotency key later.",
      idempotencyKey,
      ledgerEntryId: "ledger-43"
    }
  };
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    statusText: status === 200 ? "OK" : status === 409 ? "Conflict" : "Payment Required",
    text: async () => JSON.stringify(body),
    headers: new Headers(headers)
  };
}

function requestHeaders(fetch: ReturnType<typeof vi.fn>, index: number) {
  const init = fetch.mock.calls[index]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

describe("callCommand pending settlement reconciliation", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    loadConfig.mockResolvedValue({
      backendUrl: "https://test.example",
      sessions: {},
      wallets: { h402: { address: ADDR } }
    });
  });

  afterEach(() => {
    stdout.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    loadConfig.mockReset();
    signOwsTypedData.mockClear();
  });

  it("reuses the byte-identical signed request while settlement is pending", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(res(200, { data: { ok: true }, h402: { provider: "demo" } }));
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args());
    await vi.runAllTimersAsync();
    await execution;

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);

    const firstPaidHeaders = requestHeaders(fetch, 1);
    const retryHeaders = requestHeaders(fetch, 2);
    expect(firstPaidHeaders.get("PAYMENT-SIGNATURE")).toBeTruthy();
    expect(retryHeaders.get("PAYMENT-SIGNATURE")).toBe(firstPaidHeaders.get("PAYMENT-SIGNATURE"));
    expect(retryHeaders.get("idempotency-key")).toBe(IDEMPOTENCY_KEY);

    const firstPaidInit = fetch.mock.calls[1]?.[1] as RequestInit;
    const retryInit = fetch.mock.calls[2]?.[1] as RequestInit;
    expect(fetch.mock.calls[2]?.[0]).toBe(fetch.mock.calls[1]?.[0]);
    expect(retryInit.method).toBe(firstPaidInit.method);
    expect(retryInit.body).toBe(firstPaidInit.body);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"ok": true'));
  });

  it("stops after bounded retries and warns against signing a new payment", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(res(409, pending()));
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect((error as Error).message).toContain(IDEMPOTENCY_KEY);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);

    const signatures = fetch.mock.calls.slice(1).map((_, index) => requestHeaders(fetch, index + 1).get("PAYMENT-SIGNATURE"));
    expect(new Set(signatures).size).toBe(1);
  });

  it("signs a server-issued replacement challenge with its replacement idempotency key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("1000")))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(
        res(402, challenge("2000"), {
          "x-h402-previous-idempotency-key": IDEMPOTENCY_KEY,
          "x-h402-replacement-idempotency-key": REPLACEMENT_KEY
        })
      )
      .mockResolvedValueOnce(res(200, { data: { ok: true }, h402: { provider: "demo" } }));
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args({ "max-usd": "0.01" }));
    await vi.runAllTimersAsync();
    await execution;

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(signOwsTypedData).toHaveBeenCalledTimes(2);

    const originalHeaders = requestHeaders(fetch, 1);
    const reconciliationHeaders = requestHeaders(fetch, 2);
    const replacementHeaders = requestHeaders(fetch, 3);
    expect(reconciliationHeaders.get("PAYMENT-SIGNATURE")).toBe(originalHeaders.get("PAYMENT-SIGNATURE"));
    expect(replacementHeaders.get("idempotency-key")).toBe(REPLACEMENT_KEY);
    expect(replacementHeaders.get("PAYMENT-SIGNATURE")).toBeTruthy();
    expect(replacementHeaders.get("PAYMENT-SIGNATURE")).not.toBe(originalHeaders.get("PAYMENT-SIGNATURE"));

    const printed = JSON.parse(stdout.mock.calls.map((call) => String(call[0])).join(""));
    expect(printed.h402.signedAmount).toMatchObject({ amount: "2000", usd: "0.002" });
  });

  it("rechecks max-usd before signing a replacement challenge", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("1000")))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(
        res(402, challenge("20000"), {
          "x-h402-previous-idempotency-key": IDEMPOTENCY_KEY,
          "x-h402-replacement-idempotency-key": REPLACEMENT_KEY
        })
      );
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args({ "max-usd": "0.01" })).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/exceeds --max-usd 0\.01/);
    expect((error as Error).message).toContain(REPLACEMENT_KEY);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
  });

  it("surfaces a reconciled settlement without signing again", async () => {
    const reconciled = {
      error: {
        code: "payment_settlement_reconciled",
        message: "Payment was already settled, but the original response was lost.",
        idempotencyKey: IDEMPOTENCY_KEY,
        ledgerEntryId: "ledger-43",
        paymentReference: "0xsettled"
      }
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(res(409, reconciled));
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/already settled.*original response was lost/i);
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
  });

  it("keeps the do-not-repay guidance when a post-pending retry fails at the network layer", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("ECONNRESET");
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect((error as Error).message).toContain(IDEMPOTENCY_KEY);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps the do-not-repay guidance when a post-pending retry returns a generic 5xx", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(res(500, { error: { message: "upstream exploded" } }));
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("upstream exploded");
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect((error as Error).message).toContain(IDEMPOTENCY_KEY);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refuses a replacement challenge that does not identify the pending idempotency key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("1000")))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(res(402, challenge("2000"), { "x-h402-replacement-idempotency-key": REPLACEMENT_KEY }));
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args()).catch((thrown: unknown) => thrown);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/did not identify the pending idempotency key/i);
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refuses a replacement challenge without a preceding pending-settlement response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("1000")))
      .mockResolvedValueOnce(
        res(402, challenge("2000"), {
          "x-h402-previous-idempotency-key": IDEMPOTENCY_KEY,
          "x-h402-replacement-idempotency-key": REPLACEMENT_KEY
        })
      );
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args({ "max-usd": "0.01" })).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/without a preceding pending-settlement response/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses repeated replacement challenges", async () => {
    const secondReplacementKey = "idem-replacement-43-b";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge("1000")))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(
        res(402, challenge("2000"), {
          "x-h402-previous-idempotency-key": IDEMPOTENCY_KEY,
          "x-h402-replacement-idempotency-key": REPLACEMENT_KEY
        })
      )
      .mockResolvedValueOnce(res(409, pending(REPLACEMENT_KEY)))
      .mockResolvedValueOnce(
        res(402, challenge("3000"), {
          "x-h402-previous-idempotency-key": REPLACEMENT_KEY,
          "x-h402-replacement-idempotency-key": secondReplacementKey
        })
      );
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args({ "max-usd": "0.01" })).catch((thrown: unknown) => thrown);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/repeated replacement payment challenges/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
