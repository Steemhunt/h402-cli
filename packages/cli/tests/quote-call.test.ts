import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/utils";

const { ADDR } = vi.hoisted(() => ({ ADDR: "0x1111111111111111111111111111111111111111" }));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(async () => ({ backendUrl: "https://test.example", sessions: {}, wallets: { h402: { address: ADDR } } })),
  saveConfig: vi.fn(),
  backendUrl: () => "https://test.example"
}));

const { quoteCommand, callCommand } = await import("../src/commands");

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { status, text: async () => (body === undefined ? "" : JSON.stringify(body)), headers: new Headers(headers) };
}

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => res(status, body, headers)));
}

function args(routeId: string): ParsedArgs {
  return { positional: ["cmd", routeId], flags: {} };
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

  it("call surfaces the HTTP status, not the literal null, on an empty-body non-2xx", async () => {
    // A framework 405 / infra 502 with no JSON body used to stringify to "null".
    stubFetch(405, undefined);
    await expect(callCommand(args("web/search"))).rejects.toThrow(/Request failed: 405/);
  });

  it("quote surfaces the HTTP status, not the literal null, on an empty-body non-2xx", async () => {
    stubFetch(502, undefined);
    await expect(quoteCommand(args("web/search"))).rejects.toThrow(/Request failed: 502/);
  });
});
