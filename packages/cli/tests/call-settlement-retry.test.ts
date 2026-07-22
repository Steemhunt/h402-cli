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
      provider: "demo",
      "idempotency-key": IDEMPOTENCY_KEY,
      ...flags
    }
  };
}

function challenge() {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: BASE_USDC,
        amount: "1000",
        payTo: ADDR,
        maxTimeoutSeconds: 60
      }
    ]
  };
}

function backendError(code: string, message: string) {
  return { error: { code, message, idempotencyKey: IDEMPOTENCY_KEY, ledgerEntryId: "ledger-43" } };
}

function pending() {
  return backendError("payment_settlement_pending", "Payment settlement status could not be confirmed yet.");
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

const catalogRoute = {
  id: "web/search",
  routeKey: "search",
  category: "web",
  action: "search",
  defaultProvider: "demo",
  candidates: [{ provider: "demo", inputSchema: { type: "object" }, inputExample: { query: "h402" } }]
};

function omittedProviderArgs() {
  const parsed = args();
  delete parsed.flags.provider;
  return parsed;
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
    expect(retryHeaders.get("PAYMENT-SIGNATURE")).toBe(firstPaidHeaders.get("PAYMENT-SIGNATURE"));
    expect(retryHeaders.get("idempotency-key")).toBe(IDEMPOTENCY_KEY);

    const firstPaid = fetch.mock.calls[1] as [string, RequestInit];
    const retry = fetch.mock.calls[2] as [string, RequestInit];
    expect(firstPaid[0]).toBe("https://test.example/routes/demo/web/search");
    expect(retry[0]).toBe(firstPaid[0]);
    expect(retry[1].method).toBe(firstPaid[1].method);
    expect(retry[1].body).toBe(firstPaid[1].body);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"ok": true'));
  });

  it("keeps a catalog-selected provider path through the payable retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(200, { route: catalogRoute }))
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(200, { data: { ok: true }, h402: { provider: "demo" } }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(omittedProviderArgs());

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0][0])).toBe("https://test.example/api/catalog/routes/web/search");
    expect(String(fetch.mock.calls[1][0])).toBe("https://test.example/routes/demo/web/search");
    expect(String(fetch.mock.calls[2][0])).toBe(String(fetch.mock.calls[1][0]));
    expect(requestHeaders(fetch, 1).get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
    expect(requestHeaders(fetch, 2).get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
    expect(requestHeaders(fetch, 2).get("PAYMENT-SIGNATURE")).toBeTruthy();
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
  });

  it("does not retry or switch providers after a signed 410", async () => {
    const recovery = {
      error: { code: "provider_unavailable", message: "Provider changed" },
      routeId: "web/search",
      requestedProvider: "demo",
      defaultProvider: "other",
      candidates: [{ provider: "other", pinnedPath: "/routes/other/web/search" }]
    };
    const fetch = vi.fn().mockResolvedValueOnce(res(402, challenge())).mockResolvedValueOnce(res(410, recovery));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toBe("https://test.example/routes/demo/web/search");
    expect(String(fetch.mock.calls[1][0])).toBe(String(fetch.mock.calls[0][0]));
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ detail: expect.objectContaining({ defaultProvider: "other", candidates: recovery.candidates }) });
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
  });

  it("stops after bounded retries without creating another authorization", async () => {
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

    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    const signatures = fetch.mock.calls.slice(1).map((_, index) => requestHeaders(fetch, index + 1).get("PAYMENT-SIGNATURE"));
    expect(new Set(signatures).size).toBe(1);
  });

  it("refuses a replacement response after pending without signing again", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(
        res(402, challenge(), {
          "x-h402-previous-idempotency-key": IDEMPOTENCY_KEY,
          "x-h402-replacement-idempotency-key": REPLACEMENT_KEY
        })
      );
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toMatchObject({
      detail: {
        code: "automatic_replacement_refused",
        idempotencyKey: IDEMPOTENCY_KEY,
        settlementStatus: "unknown",
        replacementAuthorizationSigned: false,
        separateCallRequired: true
      }
    });
    expect((error as Error).message).toMatch(/did not sign a replacement authorization/i);
    expect((error as Error).message).toMatch(/separate explicit h402 call/i);
    expect((error as Error).message).toMatch(/original settlement remains unknown/i);
    expect((error as Error).message).not.toMatch(/safe to/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refuses an initial replacement response before resolving or signing a wallet", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      res(402, challenge(), {
        "x-h402-previous-idempotency-key": IDEMPOTENCY_KEY,
        "x-h402-replacement-idempotency-key": REPLACEMENT_KEY
      })
    );
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      detail: {
        code: "automatic_replacement_refused",
        settlementStatus: "unknown",
        replacementAuthorizationSigned: false,
        separateCallRequired: true
      }
    });
    expect((error as Error).message).toMatch(/did not sign a replacement authorization/i);
    expect((error as Error).message).toMatch(/original settlement remains unknown/i);
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect(signOwsTypedData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves do-not-repay guidance after a signed network failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect((error as Error).message).toContain("ECONNRESET");
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
  });

  it("preserves do-not-repay guidance after a signed gateway failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(502, { error: { message: "gateway lost the response" } }));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect((error as Error).message).toContain("gateway lost the response");
    expect((error as Error).message).toMatch(/do NOT sign or pay with a new idempotency key/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
  });

  it("does not contradict a conclusive unpaid settlement response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, pending()))
      .mockResolvedValueOnce(
        res(409, {
          error: {
            code: "payment_settlement_failed",
            message: "The original payment authorization was not settled; start a separate call to try again.",
            idempotencyKey: IDEMPOTENCY_KEY,
            paid: false,
            safeToStartNewCall: true
          }
        })
      );
    vi.stubGlobal("fetch", fetch);

    const execution = callCommand(args()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await execution;

    expect(error).toMatchObject({
      detail: {
        error: { code: "payment_settlement_failed", paid: false, safeToStartNewCall: true },
        idempotencyKey: IDEMPOTENCY_KEY
      }
    });
    expect((error as Error).message).toMatch(/original payment authorization was not settled/i);
    expect((error as Error).message).not.toMatch(/may already be completed, charged, or still settling/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      label: "omits its safety proof",
      error: { code: "payment_settlement_failed", message: "Payment settlement failed.", idempotencyKey: IDEMPOTENCY_KEY }
    },
    {
      label: "belongs to another idempotency key",
      error: {
        code: "payment_settlement_failed",
        message: "Payment settlement failed.",
        idempotencyKey: "idem-other",
        paid: false,
        safeToStartNewCall: true
      }
    }
  ])("keeps do-not-repay guidance when a terminal response $label", async ({ error: backendError }) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(402, challenge()))
      .mockResolvedValueOnce(res(409, { error: backendError }));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect((error as Error).message).toMatch(/may already be completed, charged, or still settling/i);
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "omits its safety proof",
      error: { code: "payment_settlement_failed", message: "Payment settlement failed.", idempotencyKey: IDEMPOTENCY_KEY }
    },
    {
      label: "belongs to another idempotency key",
      error: {
        code: "payment_settlement_failed",
        message: "Payment settlement failed.",
        idempotencyKey: "idem-other",
        paid: false,
        safeToStartNewCall: true
      }
    }
  ])("keeps do-not-repay guidance when an initial settlement failure $label", async ({ error: backendError }) => {
    const fetch = vi.fn().mockResolvedValueOnce(res(409, { error: backendError }));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args()).catch((thrown: unknown) => thrown);

    expect((error as Error).message).toMatch(/may already be completed, charged, or still settling/i);
    expect(signOwsTypedData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
