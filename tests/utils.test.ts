import { describe, expect, it } from "vitest";
import { buildProxyPath, parseArgs } from "../src/utils";

describe("parseArgs", () => {
  it("parses positional arguments and flags", () => {
    expect(parseArgs(["call", "web/search/exa", "--name", "agent", "--no-credit"])).toEqual({
      positional: ["call", "web/search/exa"],
      flags: { name: "agent", "no-credit": true }
    });
  });
});

describe("buildProxyPath", () => {
  it("maps route ids to backend proxy paths", () => {
    expect(buildProxyPath("web/search/exa")).toBe("/api/proxy/web/search/exa");
  });

  it("rejects malformed route ids", () => {
    expect(() => buildProxyPath("web/search")).toThrow("Route id must look like");
  });
});
