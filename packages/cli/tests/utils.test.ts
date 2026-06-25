import { describe, expect, it } from "vitest";
import { buildProxyPath, parseArgs, parseQueryFlag } from "../src/utils";

describe("parseArgs", () => {
  it("parses positional arguments and flags", () => {
    expect(parseArgs(["call", "web/search", "--name", "agent", "--no-credit"])).toEqual({
      positional: ["call", "web/search"],
      flags: { name: "agent", "no-credit": true }
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

describe("parseQueryFlag", () => {
  it("parses query parameters from a JSON object flag", () => {
    expect(parseQueryFlag({ query: "{\"placeId\":\"ChIJ123\"}" })).toEqual({ placeId: "ChIJ123" });
  });

  it("rejects non-object query flags", () => {
    expect(() => parseQueryFlag({ query: "[\"placeId\"]" })).toThrow("--query must be a JSON object");
  });
});
