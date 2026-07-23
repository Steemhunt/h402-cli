import { describe, expect, it } from "vitest";
import { searchCommand } from "../src/commands";
import { assertKnownFlags, assertTopLevelFlags, commandHelp, getVersion, isKnownCommand, resolveCommandPath, topLevelHelp } from "../src/help";

describe("version + command discovery", () => {
  it("getVersion returns the package version", () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("isKnownCommand recognizes real commands and rejects others", () => {
    expect(isKnownCommand("call")).toBe(true);
    expect(isKnownCommand("wallet")).toBe(true);
    expect(isKnownCommand("bogus")).toBe(false);
  });

  it("resolveCommandPath descends into known subcommands only", () => {
    expect(resolveCommandPath(["wallet", "balance"])).toEqual(["wallet", "balance"]);
    expect(resolveCommandPath(["wallet", "bogus"])).toEqual(["wallet"]);
    expect(resolveCommandPath(["call", "web/search"])).toEqual(["call"]);
    expect(resolveCommandPath(["bogus"])).toEqual(["bogus"]);
    expect(resolveCommandPath([])).toEqual([]);
  });
});

describe("help rendering", () => {
  it("top-level help lists every command", () => {
    const help = topLevelHelp();
    for (const command of ["wallet", "auth", "credits", "search", "show", "quote", "call"]) {
      expect(help).toContain(command);
    }
  });

  it("command help shows that command's flags and an example", () => {
    const help = commandHelp(["call"]);
    expect(help).toContain("--idempotency-key");
    expect(help).toContain("--no-credit");
    expect(help).toContain("h402 call web/search");
  });

  it("the call help includes a provider-pinned paid example", () => {
    const exampleLines = commandHelp(["call"])
      .split("\n")
      .filter((line) => line.includes("h402 call web/search"));
    expect(exampleLines).toHaveLength(1);
    expect(exampleLines[0]).toContain("--provider stableenrich-exa");
    expect(exampleLines[0]).not.toContain(" auto");
  });

  it("describes omitted-provider behavior per command", () => {
    expect(commandHelp(["show"])).toMatch(/omitted: list all enabled providers/i);
    expect(commandHelp(["quote"])).toMatch(/omitted: resolve the catalog default/i);
    expect(commandHelp(["call"])).toMatch(/omitted: resolve the catalog default/i);
  });

  it("documents full provider detail through show", () => {
    const help = commandHelp(["show"]);
    expect(help).toContain("h402 show web/search");
    expect(help).toContain("--provider");
    expect(help).toContain("full provider-native contracts");
  });

  it("describes wallet-free discovery, quoting, and conditional call payment", () => {
    const top = topLevelHelp();
    const call = commandHelp(["call"]);
    expect(top).toContain("Search the catalog without a wallet");
    expect(top).toContain("Preview the x402 PAYMENT-REQUIRED envelope without paying or a wallet");
    expect(top).toContain("Execute a route and pay if challenged");
    expect(call).toContain("Execute a route and pay if challenged");
    expect(call).toContain("h402 call ai/news");
    expect(call).not.toContain("Execute a paid proxy call");
    expect(top).toContain("x402 capability store");
  });

  it("distinguishes a signing wallet from an optional bonus-credit session", () => {
    expect(commandHelp(["wallet", "create"])).toContain("local OWS signing wallet");
    expect(commandHelp(["auth"])).toContain("bonus-credit session");
  });

  it("wallet help lists subcommands", () => {
    const help = commandHelp(["wallet"]);
    for (const sub of ["create", "list", "restore", "address", "balance", "fund"]) {
      expect(help).toContain(sub);
    }
  });

  it("subcommand help shows subcommand-specific flags", () => {
    expect(commandHelp(["wallet", "balance"])).toContain("--wallet");
  });
});

describe("assertKnownFlags", () => {
  it("accepts a command's documented flags", () => {
    expect(() => assertKnownFlags(["call"], { json: "{}", "no-credit": true, "idempotency-key": "x" })).not.toThrow();
  });

  it("always allows --help", () => {
    expect(() => assertKnownFlags(["quote"], { help: true })).not.toThrow();
  });

  it("rejects a typo'd flag with an actionable message", () => {
    expect(() => assertKnownFlags(["call"], { "idempotency-ky": "x" })).toThrow(/Unknown flag: --idempotency-ky\. Run: h402 call --help/);
  });

  it("rejects a flag that belongs to a different command", () => {
    // --json is valid for call, not for wallet balance.
    expect(() => assertKnownFlags(["wallet", "balance"], { json: "{}" })).toThrow(/Unknown flag: --json/);
  });

  it("does not validate flags for an unknown command (handler reports it)", () => {
    expect(() => assertKnownFlags(["bogus"], { anything: true })).not.toThrow();
  });

  it("rejects a value flag passed with no value (parsed as bare boolean true)", () => {
    // These would otherwise silently fall back to defaults via flagString().
    expect(() => assertKnownFlags(["call"], { "idempotency-key": true })).toThrow(/Flag --idempotency-key requires a value/);
    expect(() => assertKnownFlags(["call"], { "api-url": true })).toThrow(/Flag --api-url requires a value/);
    expect(() => assertKnownFlags(["quote"], { json: true })).toThrow(/Flag --json requires a value/);
    expect(() => assertKnownFlags(["search"], { limit: true })).toThrow(/Flag --limit requires a value/);
  });

  it("rejects a stray value on a boolean flag but still accepts true/bare", () => {
    expect(() => assertKnownFlags(["call"], { "no-credit": "web/search" })).toThrow(/Flag --no-credit does not take a value/);
    expect(() => assertKnownFlags(["call"], { "no-credit": true })).not.toThrow();
    expect(() => assertKnownFlags(["call"], { "no-credit": "true" })).not.toThrow();
  });
});

describe("assertTopLevelFlags", () => {
  it("allows --help / --version and no flags", () => {
    expect(() => assertTopLevelFlags({})).not.toThrow();
    expect(() => assertTopLevelFlags({ help: true })).not.toThrow();
    expect(() => assertTopLevelFlags({ version: true })).not.toThrow();
  });

  it("rejects an unknown top-level flag (e.g. a typo'd --version)", () => {
    expect(() => assertTopLevelFlags({ versoin: true })).toThrow(/Unknown flag: --versoin\. Run: h402 --help/);
  });
});

describe("required-arg validation", () => {
  it("search rejects an empty query before any network call", async () => {
    await expect(searchCommand({ positional: ["search"], flags: {} })).rejects.toThrow(/search query is required/);
    await expect(searchCommand({ positional: ["search", "   "], flags: {} })).rejects.toThrow(/search query is required/);
  });
});
