import { describe, expect, it } from "vitest";
import { getEvmAddress } from "../src/ows";

describe("getEvmAddress", () => {
  it("prefers the Base EVM account when present", () => {
    expect(
      getEvmAddress({
        id: "wallet-id",
        name: "h402",
        createdAt: "2026-05-18T00:00:00.000Z",
        accounts: [
          {
            chainId: "eip155:1",
            address: "0x1111111111111111111111111111111111111111",
            derivationPath: "m/44'/60'/0'/0/0"
          },
          {
            chainId: "eip155:8453",
            address: "0x2222222222222222222222222222222222222222",
            derivationPath: "m/44'/60'/0'/0/0"
          }
        ]
      })
    ).toBe("0x2222222222222222222222222222222222222222");
  });

  it("falls back to any EVM account", () => {
    expect(
      getEvmAddress({
        id: "wallet-id",
        name: "h402",
        createdAt: "2026-05-18T00:00:00.000Z",
        accounts: [
          {
            chainId: "solana:mainnet",
            address: "7Kz9",
            derivationPath: "m/44'/501'/0'/0'"
          },
          {
            chainId: "eip155:1",
            address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
            derivationPath: "m/44'/60'/0'/0/0"
          }
        ]
      })
    ).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });

  it("rejects wallets without an EVM address", () => {
    expect(() =>
      getEvmAddress({
        id: "wallet-id",
        name: "h402",
        createdAt: "2026-05-18T00:00:00.000Z",
        accounts: [
          {
            chainId: "solana:mainnet",
            address: "7Kz9",
            derivationPath: "m/44'/501'/0'/0'"
          }
        ]
      })
    ).toThrow("no EVM address");
  });
});
