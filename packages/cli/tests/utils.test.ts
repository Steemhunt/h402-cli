import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProxyPath, parseArgs, parseJsonFlag, parseQueryFlag, printJson, resolveMethod } from "../src/utils";

describe("printJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for stdout drain when a pipe applies backpressure", async () => {
    let resolveDrain: (() => void) | undefined;
    const drained = new Promise<void>((resolve) => {
      resolveDrain = resolve;
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => {
      void drained.then(() => process.stdout.emit("drain"));
      return false;
    });

    const printed = printJson({ payload: "x".repeat(128 * 1024) });
    await Promise.resolve();
    let settled = false;
    void printed.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveDrain?.();
    await expect(printed).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"payload"'));
  });
});

describe("parseArgs", () => {
  it("parses positional arguments and flags", () => {
    expect(parseArgs(["call", "web/search", "--name", "agent", "--no-credit"])).toEqual({
      positional: ["call", "web/search"],
      flags: { name: "agent", "no-credit": true }
    });
  });

  it("parses --flag=value syntax", () => {
    expect(parseArgs(["quote", "weather/current", "--query={\"q\":\"Seoul\"}", "--provider=weatherkit"])).toEqual({
      positional: ["quote", "weather/current"],
      flags: { query: '{"q":"Seoul"}', provider: "weatherkit" }
    });
  });
});

describe("buildProxyPath", () => {
  it("requires a concrete provider", () => {
    expect(() => buildProxyPath("web/search", undefined as unknown as string)).toThrow("Provider is required");
  });

  it("rejects the tombstoned auto sentinel and non-slug provider segments", () => {
    expect(() => buildProxyPath("web/search", "auto")).toThrow(/reserved/i);
    expect(() => buildProxyPath("web/search", ".")).toThrow(/provider.*slug/i);
    expect(() => buildProxyPath("web/search", "..")).toThrow(/provider.*slug/i);
  });

  it("appends primitive query parameters", () => {
    expect(buildProxyPath("maps/place-details", "google-maps", { placeId: "ChIJ123", includePhotos: false, maxResults: 3 })).toBe(
      "/routes/google-maps/maps/place-details?placeId=ChIJ123&includePhotos=false&maxResults=3"
    );
  });

  it("pins providers through the path segment", () => {
    expect(buildProxyPath("web/search", "stableenrich-exa")).toBe("/routes/stableenrich-exa/web/search");
    expect(buildProxyPath("web/search", "stableenrich-firecrawl", { query: "best AI tools" })).toBe(
      "/routes/stableenrich-firecrawl/web/search?query=best+AI+tools"
    );
  });

  it("rejects malformed route ids", () => {
    expect(() => buildProxyPath("web/search/exa", "stableenrich-exa")).toThrow("Route id must look like");
    expect(() => buildProxyPath("./search", "stableenrich-exa")).toThrow(/route id segment.*slug/i);
    expect(() => buildProxyPath("web/..", "stableenrich-exa")).toThrow(/route id segment.*slug/i);
  });

  it("rejects array, object, and null query values instead of silently dropping them", () => {
    expect(() => buildProxyPath("crypto/holders", "demo", { ids: [1, 2, 3] })).toThrow(/"ids" must be a string, number, or boolean/);
    expect(() => buildProxyPath("crypto/holders", "demo", { filter: { chain: "base" } })).toThrow(/"filter"/);
    expect(() => buildProxyPath("crypto/holders", "demo", { cursor: null })).toThrow(/"cursor"/);
  });
});

describe("parseJsonFlag", () => {
  it("parses request bodies from a JSON flag", () => {
    expect(parseJsonFlag({ json: '{"query":"Seoul"}' })).toEqual({ query: "Seoul" });
  });

  it("names --json and the expected shape when parsing fails", () => {
    expect(() => parseJsonFlag({ json: "{query: hi}" })).toThrow(/Flag --json must be valid JSON.*--json '\{"query":"Seoul"\}'/);
  });
});

describe("parseQueryFlag", () => {
  it("parses query parameters from a JSON object flag", () => {
    expect(parseQueryFlag({ query: "{\"placeId\":\"ChIJ123\"}" })).toEqual({ placeId: "ChIJ123" });
  });

  it("rejects non-object query flags", () => {
    expect(() => parseQueryFlag({ query: "[\"placeId\"]" })).toThrow(/Flag --query must be a JSON object/);
  });

  it("suggests JSON object syntax for key=value query input", () => {
    expect(() => parseQueryFlag({ query: "q=Seoul" })).toThrow(/--query must be a JSON object.*key=value syntax is not supported/);
  });

  it("rejects structured query values during parsing", () => {
    expect(() => parseQueryFlag({ query: '{"filters":["recent"]}' })).toThrow(/"filters" must be a string, number, or boolean/);
    expect(() => parseQueryFlag({ query: '{"cursor":null}' })).toThrow(/"cursor"/);
  });
});

describe("resolveMethod", () => {
  it("defaults to GET without a body and POST with one", () => {
    expect(resolveMethod({}, false)).toBe("GET");
    expect(resolveMethod({}, true)).toBe("POST");
  });

  it("honors and upper-cases an explicit --method", () => {
    expect(resolveMethod({ method: "GET" }, false)).toBe("GET");
    expect(resolveMethod({ method: "post" }, false)).toBe("POST");
  });

  it("rejects an unsupported --method instead of forwarding it", () => {
    expect(() => resolveMethod({ method: "PUT" }, false)).toThrow(/--method must be GET or POST \(got "PUT"\)/);
    expect(() => resolveMethod({ method: "delete" }, false)).toThrow(/--method must be GET or POST/);
  });

  it("rejects GET combined with a JSON body", () => {
    expect(() => resolveMethod({ method: "GET" }, true)).toThrow(/--method GET cannot be combined with --json/);
  });
});
