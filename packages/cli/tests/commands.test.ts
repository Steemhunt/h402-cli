import { describe, expect, it } from "vitest";
import { resolveSigningWallet } from "../src/commands";
import type { CliConfig } from "../src/config";
import type { ParsedArgs } from "../src/utils";

const ADDR_H402 = "0x1111111111111111111111111111111111111111";
const ADDR_ALT = "0x2222222222222222222222222222222222222222";

function config(): CliConfig {
  return {
    backendUrl: "https://h402.hunt.town",
    sessions: {},
    wallets: { h402: { address: ADDR_H402 }, alt: { address: ADDR_ALT } }
  };
}

function args(flags: Record<string, string>): ParsedArgs {
  return { positional: [], flags };
}

// The signer is always the OWS wallet keyed by name; these guards keep the
// request/challenge/payment address from ever diverging from that signer.
describe("resolveSigningWallet", () => {
  it("defaults to the h402 wallet when no flags are passed", async () => {
    await expect(resolveSigningWallet(args({}), config())).resolves.toEqual({ name: "h402", address: ADDR_H402 });
  });

  it("selects by --name", async () => {
    await expect(resolveSigningWallet(args({ name: "alt" }), config())).resolves.toEqual({ name: "alt", address: ADDR_ALT });
  });

  it("errors when --name has no known local address", async () => {
    await expect(resolveSigningWallet(args({ name: "ghost" }), config())).rejects.toThrow(/No address known for wallet "ghost"/);
  });

  it("selects the local wallet that owns the --wallet address (case-insensitive)", async () => {
    await expect(resolveSigningWallet(args({ wallet: ADDR_ALT.toUpperCase() }), config())).resolves.toEqual({ name: "alt", address: ADDR_ALT });
  });

  it("errors when the --wallet address is not owned by any local wallet", async () => {
    await expect(resolveSigningWallet(args({ wallet: "0x9999999999999999999999999999999999999999" }), config())).rejects.toThrow(/No local wallet owns address/);
  });

  it("accepts --wallet and --name together when they agree", async () => {
    await expect(resolveSigningWallet(args({ wallet: ADDR_ALT, name: "alt" }), config())).resolves.toEqual({ name: "alt", address: ADDR_ALT });
  });

  it("errors before signing when --wallet does not match --name", async () => {
    await expect(resolveSigningWallet(args({ wallet: ADDR_H402, name: "alt" }), config())).rejects.toThrow(/does not match wallet "alt"/);
  });
});
