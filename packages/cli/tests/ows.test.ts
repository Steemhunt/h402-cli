import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getEvmAddress, normalizeOwsSignature } from "../src/ows";

const here = path.dirname(fileURLToPath(import.meta.url));
const owsSource = readFileSync(path.join(here, "..", "src", "ows.ts"), "utf8");

describe("OWS module loading", () => {
  it("does not statically import native OWS bindings at CLI startup", () => {
    const staticOwsImports = owsSource
      .split("\n")
      .filter((line) => /^import(?!\s+type\b).*from ["']@open-wallet-standard\/core["']/.test(line));
    expect(staticOwsImports).toEqual([]);
    expect(owsSource).toContain('import("@open-wallet-standard/core")');
  });
});

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

describe("normalizeOwsSignature", () => {
  const signature =
    "38c762fca1447aec6f91b954de18885b7ea5df8d9348b387356309ed724b5cdd4e8d9007d636c5229b821bba2e8150e3245e09bda8bef92d211644b9039d4bee1c";

  it("adds a 0x prefix to 65-byte OWS EVM signatures", () => {
    expect(normalizeOwsSignature(signature)).toBe(`0x${signature}`);
  });

  it("appends recovery id when OWS returns a compact 64-byte signature", () => {
    expect(normalizeOwsSignature(signature.slice(0, -2), 28)).toBe(`0x${signature}`);
  });

  it("rejects malformed signatures", () => {
    expect(() => normalizeOwsSignature("not-a-signature")).toThrow("non-hex");
  });
});
