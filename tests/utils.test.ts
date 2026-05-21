import { describe, expect, it } from "vitest";
import { buildProxyPath, parseArgs } from "../src/utils";

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

  it("rejects malformed route ids", () => {
    expect(() => buildProxyPath("web/search/exa")).toThrow("Route id must look like");
  });
});
