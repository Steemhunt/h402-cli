import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/utils";

const { runOwsCli, ADDR_AGENT, ADDR_ALT } = vi.hoisted(() => ({
  runOwsCli: vi.fn(async () => "{}"),
  ADDR_AGENT: "0x1111111111111111111111111111111111111111",
  ADDR_ALT: "0x2222222222222222222222222222222222222222"
}));

vi.mock("../src/ows.js", () => ({
  runOwsCli,
  createOwsWallet: vi.fn(),
  signOwsMessage: vi.fn(),
  signOwsTypedData: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(async () => ({
    backendUrl: "https://h402.hunt.town",
    sessions: {},
    wallets: { agent: { address: ADDR_AGENT }, alt: { address: ADDR_ALT } }
  })),
  saveConfig: vi.fn(),
  backendUrl: () => "https://h402.hunt.town"
}));

const { walletCommand } = await import("../src/commands");

function args(flags: Record<string, string | boolean>, ...positional: string[]): ParsedArgs {
  return { positional: ["wallet", ...positional], flags };
}

// `wallet balance`/`fund` must select the same wallet as signing commands so that
// `--wallet 0x...` (and --name/--wallet agreement) cannot silently diverge.
describe("walletCommand balance/fund wallet selection", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    runOwsCli.mockClear();
  });

  it("resolves --wallet to the owning wallet name for OWS (balance)", async () => {
    await walletCommand(args({ wallet: ADDR_ALT.toUpperCase() }, "balance"));
    expect(runOwsCli).toHaveBeenCalledWith(["fund", "balance", "--wallet", "alt", "--chain", "base"]);
  });

  it("honors --name (balance)", async () => {
    await walletCommand(args({ name: "agent" }, "balance"));
    expect(runOwsCli).toHaveBeenCalledWith(["fund", "balance", "--wallet", "agent", "--chain", "base"]);
  });

  it("wraps raw OWS balance output in a stable JSON envelope", async () => {
    runOwsCli.mockResolvedValueOnce("   10.273934 USDC   $10.27       USDC");
    await walletCommand(args({ name: "agent" }, "balance"));
    const written = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(JSON.parse(written)).toEqual({
      wallet: { name: "agent", address: ADDR_AGENT },
      chain: "base",
      balance: { raw: "   10.273934 USDC   $10.27       USDC" }
    });
  });

  it("prints Base USDC funding instructions without invoking the broken OWS MoonPay flow", async () => {
    await walletCommand(args({ wallet: ADDR_AGENT }, "fund"));

    expect(runOwsCli).not.toHaveBeenCalled();
    const written = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(JSON.parse(written)).toEqual({
      wallet: { name: "agent", address: ADDR_AGENT },
      network: "base",
      token: "USDC",
      instructions: "Send Base USDC to this address from an exchange, bridge, or another wallet, then run h402 wallet balance --name agent."
    });
  });

  it("accepts --name and --wallet together when they agree", async () => {
    await walletCommand(args({ name: "alt", wallet: ADDR_ALT }, "balance"));
    expect(runOwsCli).toHaveBeenCalledWith(["fund", "balance", "--wallet", "alt", "--chain", "base"]);
  });

  it("rejects --wallet that disagrees with --name before calling OWS", async () => {
    await expect(walletCommand(args({ name: "agent", wallet: ADDR_ALT }, "balance"))).rejects.toThrow(/does not match wallet "agent"/);
    expect(runOwsCli).not.toHaveBeenCalled();
  });
});
