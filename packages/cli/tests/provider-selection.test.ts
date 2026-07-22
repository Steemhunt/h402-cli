import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError, errorEnvelope } from "../src/errors";
import type { ParsedArgs } from "../src/utils";

const { loadConfig } = vi.hoisted(() => ({ loadConfig: vi.fn() }));
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
  signOwsTypedData: vi.fn()
}));

const { callCommand, quoteCommand, searchCommand, showCommand } = await import("../src/commands");

const route = {
  id: "web/search",
  routeKey: "search",
  category: "web",
  action: "search",
  title: "Web search",
  summary: "Search the web",
  method: "POST",
  provider: "stableenrich-exa",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  inputExample: { query: "default" },
  price: { mode: "fixed", amountUsd: 0.01 },
  defaultProvider: "stableenrich-exa",
  defaultCandidateKey: "web/search:stableenrich-exa",
  candidates: [
    {
      provider: "stableenrich-exa",
      method: "POST",
      status: "enabled",
      price: { mode: "fixed", usd: 0.01 },
      inputSchema: { type: "object", required: ["query"] },
      inputExample: { query: "h402" },
      sampleOutput: { results: [{ title: "h402" }] }
    },
    {
      provider: "blockrun-grok",
      method: "POST",
      status: "enabled",
      price: { mode: "dynamic", minUsd: 0.001, maxUsd: 1.25 },
      inputSchema: { type: "object", required: ["query"] },
      inputExample: { query: "provider native" },
      sampleOutput: { output: "native" }
    }
  ]
};

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { status, statusText: status === 200 ? "OK" : "Gone", text: async () => JSON.stringify(body), headers: new Headers(headers) };
}
function args(command: string, flags: ParsedArgs["flags"] = {}): ParsedArgs {
  return { positional: [command, "web/search"], flags };
}
function printed(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(spy.mock.calls.map((call) => String(call[0])).join(""));
}

const challenge = {
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x", amount: "1", payTo: "0x", maxTimeoutSeconds: 60 }]
};

describe("provider-first catalog commands", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    loadConfig.mockResolvedValue({ backendUrl: "https://test.example", sessions: {}, wallets: {} });
  });
  afterEach(() => {
    stdout.mockRestore();
    vi.unstubAllGlobals();
    loadConfig.mockReset();
  });

  it("resolves an omitted call provider from detail and calls only the pinned path", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(res(200, { route })).mockResolvedValueOnce(res(200, { data: { ok: true }, h402: { provider: "stableenrich-exa" } }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(args("call", { json: '{"query":"h402"}', "idempotency-key": "idem-1" }));

    expect(String(fetch.mock.calls[0][0])).toBe("https://test.example/api/catalog/routes/web/search");
    expect(String(fetch.mock.calls[1][0])).toBe("https://test.example/routes/stableenrich-exa/web/search");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(printed(stdout).h402.cliProviderSelection).toEqual({
      source: "catalog-default",
      provider: "stableenrich-exa",
      pinnedCommand: "h402 call web/search --provider stableenrich-exa"
    });
  });

  it("validates the payment cap before resolving an omitted provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(callCommand(args("call", { "max-usd": "0.0000001" }))).rejects.toThrow(/at most 6 decimal places/);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses an explicit provider without a catalog lookup or auto path", async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { data: { ok: true }, h402: { provider: "blockrun-grok" } }));
    vi.stubGlobal("fetch", fetch);

    await callCommand(args("call", { provider: "blockrun-grok", json: '{"query":"h402"}' }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe("https://test.example/routes/blockrun-grok/web/search");
    expect(String(fetch.mock.calls[0][0])).not.toContain("/routes/auto/");
  });

  it("rejects the auto sentinel locally for call, quote, and show", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(callCommand(args("call", { provider: "auto" }))).rejects.toThrow(/auto.*reserved/i);
    await expect(quoteCommand(args("quote", { provider: "auto" }))).rejects.toThrow(/auto.*reserved/i);
    await expect(showCommand(args("show", { provider: "auto" }))).rejects.toThrow(/auto.*reserved/i);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an auto catalog default before an execution request", async () => {
    const autoRoute = {
      ...route,
      defaultProvider: "auto",
      defaultCandidateKey: "search:auto",
      candidates: [{ ...route.candidates[0], provider: "auto" }]
    };
    const fetch = vi.fn().mockResolvedValue(res(200, { route: autoRoute }));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args("call")).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CliError);
    expect(errorEnvelope(error)).toMatchObject({ error: { detail: { error: { code: "invalid_catalog_response" } } } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/api/catalog/routes/web/search");
  });

  it("validates show provider and structured query values before network work", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(showCommand(args("show", { provider: "" }))).rejects.toThrow(/provider requires a non-empty/i);
    await expect(callCommand(args("call", { query: '{"filter":{"recent":true}}' }))).rejects.toThrow(/"filter" must be a string, number, or boolean/);
    await expect(quoteCommand(args("quote", { query: '{"ids":[1,2]}' }))).rejects.toThrow(/"ids" must be a string, number, or boolean/);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("prints the default provider with a quote challenge", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(res(200, { route })).mockResolvedValueOnce(res(402, challenge));
    vi.stubGlobal("fetch", fetch);

    await quoteCommand(args("quote", { json: '{"query":"h402"}' }));

    expect(printed(stdout)).toMatchObject({
      providerSelection: {
        source: "catalog-default",
        provider: "stableenrich-exa",
        pinnedCommand: "h402 quote web/search --provider stableenrich-exa"
      },
      paymentRequired: challenge
    });
  });

  it("stops on 410 with machine-readable alternatives and never retries", async () => {
    const recovery = {
      error: { code: "provider_unavailable", message: "Provider changed" },
      routeId: "web/search",
      requestedProvider: "stableenrich-exa",
      defaultProvider: "blockrun-grok",
      candidates: [{ provider: "blockrun-grok", status: "enabled", pinnedPath: "/routes/blockrun-grok/web/search" }]
    };
    const fetch = vi.fn().mockResolvedValueOnce(res(200, { route })).mockResolvedValueOnce(res(410, recovery));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args("call", { json: '{"query":"h402"}', "idempotency-key": "idem-410" })).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CliError);
    expect(errorEnvelope(error)).toMatchObject({ error: { detail: { defaultProvider: "blockrun-grok", candidates: recovery.candidates } } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.some((call) => String(call[0]).includes("/routes/auto/"))).toBe(false);
  });

  it("preserves machine-readable route suggestions when default resolution fails", async () => {
    const missing = {
      error: { code: "route_not_found", message: "Unknown route" },
      routeId: "web/search",
      suggestions: [{ routeId: "web/answer" }]
    };
    const fetch = vi.fn().mockResolvedValue(res(404, missing));
    vi.stubGlobal("fetch", fetch);

    const error = await callCommand(args("call", { json: '{"query":"h402"}' })).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CliError);
    expect(errorEnvelope(error)).toMatchObject({ error: { detail: { suggestions: missing.suggestions } } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows every full candidate when no provider is selected", async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { route }));
    vi.stubGlobal("fetch", fetch);

    await showCommand(args("show"));

    expect(printed(stdout)).toEqual({ route });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows full route detail and one selected candidate", async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { route }));
    vi.stubGlobal("fetch", fetch);

    await showCommand(args("show", { provider: "blockrun-grok" }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(printed(stdout)).toMatchObject({
      route: { id: "web/search", routeKey: "search", defaultProvider: "stableenrich-exa" },
      candidate: { provider: "blockrun-grok", sampleOutput: { output: "native" } },
      providerSelection: { source: "explicit", provider: "blockrun-grok" }
    });
    expect(printed(stdout).route).not.toHaveProperty("provider");
    expect(printed(stdout).route).not.toHaveProperty("inputSchema");
    expect(printed(stdout).route).not.toHaveProperty("inputExample");
    expect(printed(stdout).route).not.toHaveProperty("price");
    expect(printed(stdout).route).not.toHaveProperty("candidates");
  });

  it("returns machine-readable alternatives for an unknown show provider", async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { route }));
    vi.stubGlobal("fetch", fetch);

    const error = await showCommand(args("show", { provider: "missing" })).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CliError);
    expect(errorEnvelope(error)).toMatchObject({
      error: { detail: { error: { code: "unknown_provider" }, routeId: "web/search", defaultProvider: "stableenrich-exa" } }
    });
    expect((error as CliError).detail).toMatchObject({
      alternatives: [
        { provider: "stableenrich-exa", pinnedPath: "/routes/stableenrich-exa/web/search" },
        { provider: "blockrun-grok", pinnedPath: "/routes/blockrun-grok/web/search" }
      ]
    });
  });

  it("prints compact search results without fetching detail", async () => {
    const compact = {
      query: "web",
      results: [
        {
          id: "web/search",
          title: "Web search",
          summary: "Search the web",
          method: "POST",
          providers: ["stableenrich-exa", "blockrun-grok"],
          defaultProvider: "stableenrich-exa",
          priceRangeMicroUsd: { min: "1000", max: "1250000" },
          health: { status: "healthy" }
        }
      ]
    };
    const fetch = vi.fn().mockResolvedValue(res(200, compact));
    vi.stubGlobal("fetch", fetch);

    await searchCommand({ positional: ["search", "web"], flags: {} });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(printed(stdout)).toEqual(compact);
  });
});
