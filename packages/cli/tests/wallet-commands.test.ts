import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/utils";

type MockCliConfig = { backendUrl: string; sessions: Record<string, string>; wallets: Record<string, { address?: string }> };

const { runOwsCli, createOwsWallet, getOwsWallet, listOwsWallets, loadConfig, updateConfig, updatedConfigs, ADDR_AGENT, ADDR_ALT } = vi.hoisted(() => {
  const updatedConfigs: MockCliConfig[] = [];
  const defaultConfig = (): MockCliConfig => ({
    backendUrl: "https://h402.hunt.town",
    sessions: {},
    wallets: { agent: { address: "0x1111111111111111111111111111111111111111" }, alt: { address: "0x2222222222222222222222222222222222222222" } }
  });
  const loadConfig = vi.fn(async () => defaultConfig());
  const updateConfig = vi.fn(async (updater: (config: MockCliConfig) => void | Promise<void>) => {
    const draft: MockCliConfig = { backendUrl: "https://h402.hunt.town", sessions: {}, wallets: {} };
    await updater(draft);
    updatedConfigs.push(draft);
    return draft;
  });
  return {
    runOwsCli: vi.fn(async () => "{}"),
    createOwsWallet: vi.fn(),
    getOwsWallet: vi.fn(),
    listOwsWallets: vi.fn(),
    loadConfig,
    updateConfig,
    updatedConfigs,
    ADDR_AGENT: "0x1111111111111111111111111111111111111111",
    ADDR_ALT: "0x2222222222222222222222222222222222222222"
  };
});

vi.mock("../src/ows.js", () => ({
  runOwsCli,
  createOwsWallet,
  getOwsWallet,
  listOwsWallets,
  signOwsMessage: vi.fn(),
  signOwsTypedData: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  loadConfig,
  updateConfig,
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
    loadConfig.mockResolvedValue({
      backendUrl: "https://h402.hunt.town",
      sessions: {},
      wallets: { agent: { address: ADDR_AGENT }, alt: { address: ADDR_ALT } }
    });
    updateConfig.mockClear();
    updatedConfigs.length = 0;
    getOwsWallet.mockReset();
    listOwsWallets.mockReset();
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

  it("explains how to recover when create finds an existing OWS wallet name", async () => {
    createOwsWallet.mockRejectedValueOnce(new Error("wallet name already exists: 'agent'"));

    await expect(walletCommand(args({ name: "agent" }, "create"))).rejects.toThrow(
      /Wallet "agent" already exists.*h402 wallet address --name agent.*h402 wallet restore/
    );
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("re-adopts an OWS wallet by name when the h402 config mapping is missing", async () => {
    const config: MockCliConfig = { backendUrl: "https://h402.hunt.town", sessions: {}, wallets: {} };
    loadConfig.mockResolvedValueOnce(config);
    getOwsWallet.mockResolvedValueOnce({ name: "agent", address: ADDR_AGENT });

    await walletCommand(args({ name: "agent" }, "address"));

    expect(updatedConfigs).toEqual([
      {
        backendUrl: "https://h402.hunt.town",
        sessions: {},
        wallets: { agent: { address: ADDR_AGENT } }
      }
    ]);
    const written = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(JSON.parse(written)).toEqual({ wallet: { name: "agent", address: ADDR_AGENT } });
  });

  it("rejects --wallet mismatches even after re-adopting an OWS wallet by name", async () => {
    const config: MockCliConfig = { backendUrl: "https://h402.hunt.town", sessions: {}, wallets: {} };
    loadConfig.mockResolvedValueOnce(config);
    getOwsWallet.mockResolvedValueOnce({ name: "agent", address: ADDR_AGENT });

    await expect(walletCommand(args({ name: "agent", wallet: ADDR_ALT }, "address"))).rejects.toThrow(/does not match wallet "agent"/);
  });

  it("lists OWS wallets without changing config", async () => {
    listOwsWallets.mockResolvedValueOnce([
      { name: "agent", address: ADDR_AGENT },
      { name: "alt", address: ADDR_ALT.toUpperCase() }
    ]);

    await walletCommand(args({}, "list"));

    expect(updateConfig).not.toHaveBeenCalled();
    const written = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(JSON.parse(written)).toEqual({
      wallets: [
        { name: "agent", address: ADDR_AGENT },
        { name: "alt", address: ADDR_ALT }
      ]
    });
  });

  it("restores OWS wallets into config", async () => {
    const config: MockCliConfig = { backendUrl: "https://h402.hunt.town", sessions: {}, wallets: {} };
    loadConfig.mockResolvedValueOnce(config);
    listOwsWallets.mockResolvedValueOnce([
      { name: "agent", address: ADDR_AGENT },
      { name: "alt", address: ADDR_ALT.toUpperCase() }
    ]);

    await walletCommand(args({}, "restore"));

    expect(updatedConfigs).toEqual([
      {
        backendUrl: "https://h402.hunt.town",
        sessions: {},
        wallets: { agent: { address: ADDR_AGENT }, alt: { address: ADDR_ALT } }
      }
    ]);
    const written = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(JSON.parse(written)).toEqual({
      wallets: [
        { name: "agent", address: ADDR_AGENT },
        { name: "alt", address: ADDR_ALT }
      ]
    });
  });

  it("rejects --wallet that disagrees with --name before calling OWS", async () => {
    await expect(walletCommand(args({ name: "agent", wallet: ADDR_ALT }, "balance"))).rejects.toThrow(/does not match wallet "agent"/);
    expect(runOwsCli).not.toHaveBeenCalled();
  });
});
