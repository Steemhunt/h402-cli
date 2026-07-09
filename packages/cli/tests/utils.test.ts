import { describe, expect, it } from "vitest";
import { buildProxyPath, parseArgs, parseJsonFlag, parseQueryFlag, resolveMethod } from "../src/utils";

describe("parseArgs", () => {
  it("parses positional arguments and flags", () => {
    expect(parseArgs(["call", "web/search", "--name", "agent", "--no-credit"])).toEqual({
      positional: ["call", "web/search"],
      flags: { name: "agent", "no-credit": true }
    });
  });

  it("parses --flag=value syntax", () => {
    expect(parseArgs(["quote", "weather/current", "--query={\"q\":\"Seoul\"}", "--provider=auto"])).toEqual({
      positional: ["quote", "weather/current"],
      flags: { query: '{"q":"Seoul"}', provider: "auto" }
    });
  });
});

describe("buildProxyPath", () => {
  it("maps route ids to auto-routed backend paths", () => {
    expect(buildProxyPath("web/search")).toBe("/routes/auto/web/search");
  });

  it("appends primitive query parameters", () => {
    expect(buildProxyPath("maps/place-details", { placeId: "ChIJ123", includePhotos: false, maxResults: 3 })).toBe(
      "/routes/auto/maps/place-details?placeId=ChIJ123&includePhotos=false&maxResults=3"
    );
  });

  it("pins providers through the path segment", () => {
    expect(buildProxyPath("web/search", undefined, "stableenrich-exa")).toBe("/routes/stableenrich-exa/web/search");
    expect(buildProxyPath("web/search", { query: "best AI tools" }, "stableenrich-firecrawl")).toBe(
      "/routes/stableenrich-firecrawl/web/search?query=best+AI+tools"
    );
  });

  it("rejects malformed route ids", () => {
    expect(() => buildProxyPath("web/search/exa")).toThrow("Route id must look like");
  });

  it("rejects array, object, and null query values instead of silently dropping them", () => {
    expect(() => buildProxyPath("crypto/holders", { ids: [1, 2, 3] })).toThrow(/"ids" must be a string, number, or boolean/);
    expect(() => buildProxyPath("crypto/holders", { filter: { chain: "base" } })).toThrow(/"filter"/);
    expect(() => buildProxyPath("crypto/holders", { cursor: null })).toThrow(/"cursor"/);
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
