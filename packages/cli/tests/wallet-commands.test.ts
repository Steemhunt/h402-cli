import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/utils";
import { configMockFactory, owsMockFactory, printed } from "./helpers";

type MockCliConfig = { backendUrl: string; sessions: Record<string, string>; wallets: Record<string, { address?: string }> };

const { createOwsWallet, getOwsWallet, listOwsWallets, getArcTestnetUsdcBalance, loadConfig, updateConfig, updatedConfigs, ADDR_AGENT, ADDR_ALT } = vi.hoisted(() => {
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
    createOwsWallet: vi.fn(),
    getOwsWallet: vi.fn(),
    listOwsWallets: vi.fn(),
    getArcTestnetUsdcBalance: vi.fn(async () => ({ microUsdc: "955900", usdc: "0.955900" })),
    loadConfig,
    updateConfig,
    updatedConfigs,
    ADDR_AGENT: "0x1111111111111111111111111111111111111111",
    ADDR_ALT: "0x2222222222222222222222222222222222222222"
  };
});

vi.mock("../src/ows.js", () => owsMockFactory({ createOwsWallet, getOwsWallet, listOwsWallets }));

vi.mock("../src/arc-testnet-usdc-balance.js", () => ({
  ARC_TESTNET_USDC_BALANCE_NETWORK: { name: "arc-testnet", chainId: 5042002 },
  ARC_TESTNET_USDC_BALANCE_ASSET: { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  ARC_TESTNET_FAUCET_URL: "https://faucet.circle.com",
  ARC_TESTNET_EXPLORER_URL: "https://testnet.arcscan.app",
  getArcTestnetUsdcBalance
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
      sessions: {},
      wallets: { agent: { address: ADDR_AGENT }, alt: { address: ADDR_ALT } }
    });
    updateConfig.mockClear();
    updatedConfigs.length = 0;
    createOwsWallet.mockReset();
    getOwsWallet.mockReset();
    listOwsWallets.mockReset();
    getArcTestnetUsdcBalance.mockClear();
    getArcTestnetUsdcBalance.mockResolvedValue({ microUsdc: "955900", usdc: "0.955900" });
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it("resolves --wallet to the owning wallet address for balance", async () => {
    await walletCommand(args({ wallet: ADDR_ALT.toUpperCase() }, "balance"));
    expect(getArcTestnetUsdcBalance).toHaveBeenCalledWith(ADDR_ALT);
  });

  it("honors --name (balance)", async () => {
    await walletCommand(args({ name: "agent" }, "balance"));
    expect(getArcTestnetUsdcBalance).toHaveBeenCalledWith(ADDR_AGENT);
  });

  it("prints structured Arc Testnet USDC balance", async () => {
    await walletCommand(args({ name: "agent" }, "balance"));
    expect(printed(stdout)).toEqual({
      wallet: { name: "agent", address: ADDR_AGENT },
      network: { name: "arc-testnet", chainId: 5042002 },
      asset: { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
      balance: { microUsdc: "955900", usdc: "0.955900" }
    });
  });

  it("prints Arc Testnet USDC faucet and explorer instructions", async () => {
    await walletCommand(args({ wallet: ADDR_AGENT }, "fund"));

    expect(printed(stdout)).toEqual({
      wallet: { name: "agent", address: ADDR_AGENT },
      network: "arc-testnet",
      token: "USDC",
      faucet: "https://faucet.circle.com",
      explorer: `https://testnet.arcscan.app/address/${ADDR_AGENT}`,
      instructions:
        "Request Arc Testnet USDC from https://faucet.circle.com, or send Arc Testnet USDC to this address, then run h402 wallet balance --name agent."
    });
  });

  it("rejects extra wallet positionals before OWS work", async () => {
    await expect(walletCommand(args({ name: "agent" }, "create", '{"ignored":true}'))).rejects.toThrow(/Unexpected positional argument/);
    expect(createOwsWallet).not.toHaveBeenCalled();
  });

  it("persists and prints a newly created wallet", async () => {
    createOwsWallet.mockResolvedValueOnce({ name: "agent", address: ADDR_AGENT });
    const loaded: MockCliConfig = { backendUrl: "https://h402.hunt.town", sessions: {}, wallets: {} };
    loadConfig.mockResolvedValueOnce(loaded);

    await walletCommand(args({ name: "agent" }, "create"));

    expect(updatedConfigs).toEqual([
      {
        backendUrl: "https://h402.hunt.town",
        sessions: {},
        wallets: { agent: { address: ADDR_AGENT } }
      }
    ]);
    // The in-memory config loaded at command entry adopts the wallet too, in
    // memory-then-durable order, matching the by-name/by-address/restore paths.
    expect(loaded.wallets).toEqual({ agent: { address: ADDR_AGENT } });
    expect(printed(stdout)).toEqual({ wallet: { name: "agent", address: ADDR_AGENT } });
  });

  it("re-adopts an OWS wallet by address when the h402 config mapping is missing", async () => {
    loadConfig.mockResolvedValueOnce({ backendUrl: "https://h402.hunt.town", sessions: {}, wallets: {} });
    listOwsWallets.mockResolvedValueOnce([{ name: "alt", address: ADDR_ALT.toUpperCase() }]);

    await walletCommand(args({ wallet: ADDR_ALT }, "address"));

    expect(updatedConfigs).toEqual([
      {
        backendUrl: "https://h402.hunt.town",
        sessions: {},
        wallets: { alt: { address: ADDR_ALT } }
      }
    ]);
    expect(printed(stdout)).toEqual({ wallet: { name: "alt", address: ADDR_ALT } });
  });

  it("accepts --name and --wallet together when they agree", async () => {
    await walletCommand(args({ name: "alt", wallet: ADDR_ALT }, "balance"));
    expect(getArcTestnetUsdcBalance).toHaveBeenCalledWith(ADDR_ALT);
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
    expect(printed(stdout)).toEqual({ wallet: { name: "agent", address: ADDR_AGENT } });
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
    expect(printed(stdout)).toEqual({
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
    expect(printed(stdout)).toEqual({
      wallets: [
        { name: "agent", address: ADDR_AGENT },
        { name: "alt", address: ADDR_ALT }
      ]
    });
  });

  it("rejects --wallet that disagrees with --name before calling OWS", async () => {
    await expect(walletCommand(args({ name: "agent", wallet: ADDR_ALT }, "balance"))).rejects.toThrow(/does not match wallet "agent"/);
    expect(getArcTestnetUsdcBalance).not.toHaveBeenCalled();
  });
});
