import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig as MockCliConfig } from "../src/config";
import type { ParsedArgs } from "../src/utils";
import { configMockFactory, owsMockFactory, printed } from "./helpers";

const { createOwsWallet, getOwsWallet, listOwsWallets, getBaseUsdcBalance, loadConfig, updateConfig, ADDR_AGENT, ADDR_ALT } = vi.hoisted(() => {
  const defaultConfig = (): MockCliConfig => ({
    backendUrl: "https://h402.hunt.town",
    sessions: {}
  });
  const loadConfig = vi.fn(async () => defaultConfig());
  const updateConfig = vi.fn();
  return {
    createOwsWallet: vi.fn(),
    getOwsWallet: vi.fn(),
    listOwsWallets: vi.fn(),
    getBaseUsdcBalance: vi.fn(async () => ({ microUsdc: "955900", usdc: "0.955900" })),
    loadConfig,
    updateConfig,
    ADDR_AGENT: "0x1111111111111111111111111111111111111111",
    ADDR_ALT: "0x2222222222222222222222222222222222222222"
  };
});

vi.mock("../src/ows.js", () => owsMockFactory({ createOwsWallet, getOwsWallet, listOwsWallets }));

vi.mock("../src/base-usdc-balance.js", () => ({
  BASE_USDC_BALANCE_NETWORK: { name: "base", chainId: 8453 },
  BASE_USDC_BALANCE_ASSET: { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  getBaseUsdcBalance
}));

vi.mock("../src/config.js", () => configMockFactory({ loadConfig, updateConfig, backendUrl: "https://h402.hunt.town" }));

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
      sessions: {}
    });
    updateConfig.mockClear();
    createOwsWallet.mockReset();
    getOwsWallet.mockReset().mockImplementation(async (name: string) => ({ name, address: name === "alt" ? ADDR_ALT : ADDR_AGENT }));
    listOwsWallets.mockReset().mockResolvedValue([{ name: "agent", address: ADDR_AGENT }, { name: "alt", address: ADDR_ALT }]);
    getBaseUsdcBalance.mockClear();
    getBaseUsdcBalance.mockResolvedValue({ microUsdc: "955900", usdc: "0.955900" });
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it("resolves --wallet to the owning wallet address for balance", async () => {
    await walletCommand(args({ wallet: ADDR_ALT.toUpperCase() }, "balance"));
    expect(getBaseUsdcBalance).toHaveBeenCalledWith(ADDR_ALT);
  });

  it("honors --name (balance)", async () => {
    await walletCommand(args({ name: "agent" }, "balance"));
    expect(getBaseUsdcBalance).toHaveBeenCalledWith(ADDR_AGENT);
  });

  it.each(["address", "balance", "fund"])("uses the configured default wallet for %s", async (subcommand) => {
    loadConfig.mockResolvedValueOnce({
      backendUrl: "https://h402.hunt.town",
      sessions: {},
      defaultWallet: "alt"
    });

    await walletCommand(args({}, subcommand));

    expect(printed(stdout).wallet).toEqual({ name: "alt", address: ADDR_ALT });
  });

  it.each([{ flags: {}, name: "agent" }, { flags: { name: "alt" }, name: "alt" }])("selects $name for creation with a configured default", async ({ flags, name }) => {
    loadConfig.mockResolvedValueOnce({ backendUrl: "https://h402.hunt.town", sessions: {}, defaultWallet: "agent" });
    createOwsWallet.mockResolvedValueOnce({ name, address: ADDR_AGENT });

    await walletCommand(args(flags, "create"));

    expect(createOwsWallet).toHaveBeenCalledWith(name, undefined);
    expect(printed(stdout).wallet).toEqual({ name, address: ADDR_AGENT });
  });

  it("prints structured Base USDC balance", async () => {
    await walletCommand(args({ name: "agent" }, "balance"));
    expect(printed(stdout)).toEqual({
      wallet: { name: "agent", address: ADDR_AGENT },
      network: { name: "base", chainId: 8453 },
      asset: { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
      balance: { microUsdc: "955900", usdc: "0.955900" }
    });
  });

  it("prints a Base USDC funding link without invoking the OWS MoonPay flow", async () => {
    await walletCommand(args({ wallet: ADDR_AGENT }, "fund"));

    expect(printed(stdout)).toEqual({
      wallet: { name: "agent", address: ADDR_AGENT },
      network: "base",
      token: "USDC",
      suggestedAmount: "5",
      fundingUrl: `https://h402.hunt.town/wallet/fund?address=${ADDR_AGENT}&amount=5`,
      status: "awaiting_funds"
    });
  });

  it("rejects extra wallet positionals before OWS work", async () => {
    await expect(walletCommand(args({ name: "agent" }, "create", '{"ignored":true}'))).rejects.toThrow(/Unexpected positional argument/);
    expect(createOwsWallet).not.toHaveBeenCalled();
  });

  it.each(["agent", "__proto__"])("prints newly created native wallet %s without writing an address cache", async (name) => {
    createOwsWallet.mockResolvedValueOnce({ name, address: ADDR_AGENT });
    await walletCommand(args({ name }, "create"));
    expect(printed(stdout)).toEqual({ wallet: { name, address: ADDR_AGENT } });
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it.each(["address", "balance", "fund"])("reads a recreated wallet's current native address for %s", async (subcommand) => {
    await walletCommand(args({ name: "agent" }, subcommand));
    expect(printed(stdout).wallet.address).toBe(ADDR_AGENT);
    stdout.mockClear();
    getOwsWallet.mockResolvedValueOnce({ name: "agent", address: ADDR_ALT });
    await walletCommand(args({ name: "agent" }, subcommand));
    expect(printed(stdout).wallet.address).toBe(ADDR_ALT);
    if (subcommand === "fund") expect(printed(stdout).fundingUrl).toContain(ADDR_ALT);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it.each(["wallet not found", "native bindings unavailable", "permission denied"])("stops funding on %s without returning a funding link", async (message) => {
    getOwsWallet.mockRejectedValueOnce(new Error(message));
    await expect(walletCommand(args({ name: "agent" }, "fund"))).rejects.toThrow(message);
    expect(stdout).not.toHaveBeenCalled();
    expect(getBaseUsdcBalance).not.toHaveBeenCalled();
  });

  it("rejects the removed restore command without reading the vault", async () => {
    await expect(walletCommand(args({}, "restore"))).rejects.toThrow("Unknown wallet subcommand: restore");
    expect(listOwsWallets).not.toHaveBeenCalled();
  });

  it("accepts --name and --wallet together when they agree", async () => {
    await walletCommand(args({ name: "alt", wallet: ADDR_ALT }, "balance"));
    expect(getBaseUsdcBalance).toHaveBeenCalledWith(ADDR_ALT);
  });

  it("explains how to recover when create finds an existing OWS wallet name", async () => {
    createOwsWallet.mockRejectedValueOnce(new Error("wallet name already exists: 'agent'"));

    await expect(walletCommand(args({ name: "agent" }, "create"))).rejects.toThrow(
      /Wallet "agent" already exists.*h402 wallet address --name agent/
    );
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("lists OWS wallets without changing config", async () => {
    listOwsWallets.mockResolvedValueOnce([
      { name: "agent", address: ADDR_AGENT },
      { name: "alt", address: ADDR_ALT.toUpperCase() }
    ]);

    await walletCommand(args({}, "list"));

    expect(updateConfig).not.toHaveBeenCalled();
    expect(printed(stdout)).toEqual({
      wallets: [
        { name: "agent", address: ADDR_AGENT },
        { name: "alt", address: ADDR_ALT }
      ]
    });
  });

  it("rejects conflicting wallet selectors before reading the balance", async () => {
    await expect(walletCommand(args({ name: "agent", wallet: ADDR_ALT }, "balance"))).rejects.toThrow(/does not match wallet "agent"/);
    expect(getBaseUsdcBalance).not.toHaveBeenCalled();
  });
});
