import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError, errorEnvelope } from "../src/errors";
import type { ParsedArgs } from "../src/utils";

const { ADDR } = vi.hoisted(() => ({ ADDR: "0x1111111111111111111111111111111111111111" }));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(async () => ({ backendUrl: "https://test.example", sessions: {}, wallets: { h402: { address: ADDR } } })),
  saveConfig: vi.fn(),
  backendUrl: () => "https://test.example"
}));

const { quoteCommand, callCommand, searchCommand } = await import("../src/commands");

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { status, text: async () => (body === undefined ? "" : JSON.stringify(body)), headers: new Headers(headers) };
}

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => res(status, body, headers)));
}

function args(routeId: string, flags: ParsedArgs["flags"] = {}, ...extra: string[]): ParsedArgs {
  return { positional: ["cmd", routeId, ...extra], flags };
}

const challenge = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x", amount: "1", payTo: "0x", maxTimeoutSeconds: 60 }] };

describe("quote/call exit codes on backend responses", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    vi.unstubAllGlobals();
  });

  for (const status of [400, 404, 500]) {
    it(`quote throws on ${status} (no payment challenge)`, async () => {
      stubFetch(status, { error: "backend boom" });
      await expect(quoteCommand(args("web/search"))).rejects.toThrow(/backend boom/);
    });

    it(`call throws on ${status} first response`, async () => {
      stubFetch(status, { error: "backend boom" });
      await expect(callCommand(args("web/search"))).rejects.toThrow(/backend boom/);
    });
  }

  it("quote prints the challenge on a 402 (expected success)", async () => {
    stubFetch(402, challenge);
    await expect(quoteCommand(args("web/search"))).resolves.toBeUndefined();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("paymentRequired"));
  });

  it("quote falls through to the HTTP error when PAYMENT-REQUIRED is malformed", async () => {
    stubFetch(402, { error: "backend sent malformed challenge" }, { "PAYMENT-REQUIRED": "not base64" });
    await expect(quoteCommand(args("web/search"))).rejects.toThrow(/backend sent malformed challenge/);
  });

  it("quote prints the body for a free route (2xx, no challenge)", async () => {
    stubFetch(200, { result: 42 });
    await quoteCommand(args("web/free"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("42"));
  });

  it("call prints the body when the first response is a 2xx (free / credit-covered)", async () => {
    stubFetch(200, { result: 42 });
    await callCommand(args("web/free"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("42"));
  });

  it("rejects extra quote positionals before sending a request", async () => {
    const fetch = vi.fn(async () => res(200, { result: 42 }));
    vi.stubGlobal("fetch", fetch);
    await expect(quoteCommand(args("crypto/fear-greed", {}, '{"limit":5}'))).rejects.toThrow(/Unexpected positional argument.*--json/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects extra call positionals before sending a request", async () => {
    const fetch = vi.fn(async () => res(200, { result: 42 }));
    vi.stubGlobal("fetch", fetch);
    await expect(callCommand(args("crypto/fear-greed", {}, '{"limit":5}'))).rejects.toThrow(/Unexpected positional argument.*--json/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("call surfaces the HTTP status, not the literal null, on an empty-body non-2xx", async () => {
    // A framework 405 / infra 502 with no JSON body used to stringify to "null".
    stubFetch(405, undefined);
    await expect(callCommand(args("web/search"))).rejects.toThrow(/Request failed: 405/);
  });

  it("quote surfaces the HTTP status, not the literal null, on an empty-body non-2xx", async () => {
    stubFetch(502, undefined);
    await expect(quoteCommand(args("web/search"))).rejects.toThrow(/Request failed: 502/);
  });

  it("throws a CliError carrying the backend error body so the stderr envelope stays structured", async () => {
    const backend = { error: { code: "provider_native_field_requires_pinning", message: "pin it" } };
    stubFetch(422, backend);
    const error = await callCommand(args("web/search", { "idempotency-key": "idem-123" })).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CliError);
    expect(errorEnvelope(error)).toEqual({
      error: {
        message: "Request failed: 422: pin it (idempotency-key: idem-123)",
        detail: { idempotencyKey: "idem-123", ...backend }
      }
    });
  });

  it("rejects --query with a POST body before sending a quote request", async () => {
    const fetch = vi.fn(async () => res(200, { result: 42 }));
    vi.stubGlobal("fetch", fetch);
    await expect(quoteCommand(args("web/search", { json: '{"query":"h402"}', query: '{"limit":5}' }))).rejects.toThrow(/--query cannot be combined with POST/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects --query with an explicit POST call before resolving payment", async () => {
    const fetch = vi.fn(async () => res(200, { result: 42 }));
    vi.stubGlobal("fetch", fetch);
    await expect(callCommand(args("web/search", { method: "POST", query: '{"limit":5}' }))).rejects.toThrow(/--query cannot be combined with POST/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("builds catalog search URLs with URLSearchParams", async () => {
    const fetch = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal("fetch", fetch);
    await searchCommand({ positional: ["search", "web search"], flags: { limit: "5" } });
    expect(String(fetch.mock.calls[0][0])).toBe("https://test.example/api/catalog/search?q=web+search&limit=5");
  });

  it("rejects injected search limits before sending a request", async () => {
    const fetch = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal("fetch", fetch);
    await expect(searchCommand({ positional: ["search", "web"], flags: { limit: "5&q=evil" } })).rejects.toThrow(/--limit must be a positive integer/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
