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
  it("maps route ids to backend proxy paths", () => {
    expect(buildProxyPath("web/search")).toBe("/api/proxy/web/search");
  });

  it("appends primitive query parameters", () => {
    expect(buildProxyPath("maps/place-details", { placeId: "ChIJ123", includePhotos: false, maxResults: 3 })).toBe(
      "/api/proxy/maps/place-details?placeId=ChIJ123&includePhotos=false&maxResults=3"
    );
  });

  it("appends provider override parameters", () => {
    expect(buildProxyPath("web/search", undefined, "exa")).toBe("/api/proxy/web/search?provider=exa");
    expect(buildProxyPath("web/search", { query: "best AI tools", provider: "ignored" }, "firecrawl")).toBe(
      "/api/proxy/web/search?query=best+AI+tools&provider=firecrawl"
    );
  });

  it("rejects malformed route ids", () => {
    expect(() => buildProxyPath("web/search/exa")).toThrow("Route id must look like");
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
