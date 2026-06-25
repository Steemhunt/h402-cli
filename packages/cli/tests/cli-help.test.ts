import { describe, expect, it } from "vitest";
import { searchCommand } from "../src/commands";
import { assertKnownFlags, commandHelp, getVersion, isKnownCommand, resolveCommandPath, topLevelHelp } from "../src/help";

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
    for (const command of ["wallet", "auth", "credits", "search", "quote", "call"]) {
      expect(help).toContain(command);
    }
  });

  it("command help shows that command's flags and an example", () => {
    const help = commandHelp(["call"]);
    expect(help).toContain("--idempotency-key");
    expect(help).toContain("--no-credit");
    expect(help).toContain("h402 call web/search");
  });

  it("wallet help lists subcommands", () => {
    const help = commandHelp(["wallet"]);
    for (const sub of ["create", "address", "balance", "fund"]) {
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
});

describe("required-arg validation", () => {
  it("search rejects an empty query before any network call", async () => {
    await expect(searchCommand({ positional: ["search"], flags: {} })).rejects.toThrow(/search query is required/);
    await expect(searchCommand({ positional: ["search", "   "], flags: {} })).rejects.toThrow(/search query is required/);
  });
});
