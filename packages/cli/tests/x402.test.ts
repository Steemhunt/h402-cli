import { describe, expect, it, vi } from "vitest";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  ARC_TESTNET_USDC_ADDRESS,
  decodeX402Header,
  selectExactRequirement,
  type X402PaymentPayload,
  type X402PaymentRequired
} from "@h402/core";

const { signOwsTypedData } = vi.hoisted(() => ({
  signOwsTypedData: vi.fn(async () => `0x${"11".repeat(65)}` as `0x${string}`)
}));

vi.mock("../src/ows.js", () => ({ signOwsTypedData }));

import { ARC_TESTNET_USDC_REQUIREMENT_OPTIONS, createPaymentSignatureHeader } from "../src/x402";

const usdcRequirement = {
  scheme: "exact" as const,
  network: ARC_TESTNET_NETWORK,
  asset: ARC_TESTNET_USDC_ADDRESS,
  amount: "50000",
  payTo: "0x1677383A7Bec2cf618FC98aeF68b757BcFc37F27",
  maxTimeoutSeconds: 120
};

function challenge(requirement: Record<string, unknown>): X402PaymentRequired {
  return { x402Version: 2, accepts: [requirement as unknown as X402PaymentRequired["accepts"][number]] };
}

// Reject paths throw inside selectExactRequirement, before any wallet is touched,
// so these need no OWS signer.
const DUMMY = { walletAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`, walletName: "test" };

describe("ARC_TESTNET_USDC_REQUIREMENT_OPTIONS", () => {
  it("pins the canonical Arc Testnet USDC contract", () => {
    expect(ARC_TESTNET_USDC_ADDRESS).toBe("0x3600000000000000000000000000000000000000");
  });

  it("accepts an Arc Testnet USDC exact requirement (case-insensitive asset)", () => {
    const accepted = selectExactRequirement(
      challenge({ ...usdcRequirement, asset: ARC_TESTNET_USDC_ADDRESS.toUpperCase() }),
      ARC_TESTNET_USDC_REQUIREMENT_OPTIONS
    );
    expect(accepted.asset).toBe(ARC_TESTNET_USDC_ADDRESS.toUpperCase());
  });

  it("rejects a non-USDC asset", () => {
    expect(() =>
      selectExactRequirement(
        challenge({ ...usdcRequirement, asset: "0xdeadbeef00000000000000000000000000000000" }),
        ARC_TESTNET_USDC_REQUIREMENT_OPTIONS
      )
    ).toThrow(/only signs Arc Testnet USDC/);
  });

  it("rejects non-eip3009 transfer methods on the USDC asset (native, permit2)", () => {
    for (const assetTransferMethod of ["native", "permit2"]) {
      expect(() =>
        selectExactRequirement(challenge({ ...usdcRequirement, extra: { assetTransferMethod } }), ARC_TESTNET_USDC_REQUIREMENT_OPTIONS)
      ).toThrow(/only signs Arc Testnet USDC/);
    }
  });

  it("accepts an explicit eip3009 method", () => {
    const accepted = selectExactRequirement(
      challenge({ ...usdcRequirement, extra: { assetTransferMethod: "eip3009" } }),
      ARC_TESTNET_USDC_REQUIREMENT_OPTIONS
    );
    expect(accepted.asset).toBe(ARC_TESTNET_USDC_ADDRESS);
  });

  it("rejects a requirement on the wrong network", () => {
    expect(() =>
      selectExactRequirement(challenge({ ...usdcRequirement, network: "eip155:1" }), ARC_TESTNET_USDC_REQUIREMENT_OPTIONS)
    ).toThrow(/only signs Arc Testnet USDC/);
  });

  it("rejects the former Base payment rail", () => {
    expect(() =>
      selectExactRequirement(
        challenge({
          ...usdcRequirement,
          network: "eip155:8453",
          asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        }),
        ARC_TESTNET_USDC_REQUIREMENT_OPTIONS
      )
    ).toThrow(/only signs Arc Testnet USDC/);
  });

  it("ignores a malformed (non-string) asset entry and still selects the valid USDC one", () => {
    const accepted = selectExactRequirement(
      { x402Version: 2, accepts: [{ ...usdcRequirement, asset: null }, usdcRequirement] } as unknown as X402PaymentRequired,
      ARC_TESTNET_USDC_REQUIREMENT_OPTIONS
    );
    expect(accepted.asset).toBe(ARC_TESTNET_USDC_ADDRESS);
  });
});

describe("createPaymentSignatureHeader guards", () => {
  it("refuses to sign a non-USDC challenge before touching the wallet", async () => {
    await expect(
      createPaymentSignatureHeader({ paymentRequired: challenge({ ...usdcRequirement, asset: "0xdeadbeef00000000000000000000000000000000" }), ...DUMMY })
    ).rejects.toThrow(/only signs Arc Testnet USDC/);
  });

  it("refuses to sign a native-transfer challenge", async () => {
    await expect(
      createPaymentSignatureHeader({ paymentRequired: challenge({ ...usdcRequirement, extra: { assetTransferMethod: "native" } }), ...DUMMY })
    ).rejects.toThrow(/only signs Arc Testnet USDC/);
  });

  it("refuses to sign a wrong-network challenge", async () => {
    await expect(
      createPaymentSignatureHeader({ paymentRequired: challenge({ ...usdcRequirement, network: "eip155:1" }), ...DUMMY })
    ).rejects.toThrow(/only signs Arc Testnet USDC/);
  });

  it("signs with the Arc Testnet USDC EIP-712 domain", async () => {
    const header = await createPaymentSignatureHeader({ paymentRequired: challenge(usdcRequirement), ...DUMMY, authorizationNow: 1_000 });

    expect(signOwsTypedData).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({
        domain: {
          name: "USDC",
          version: "2",
          chainId: ARC_TESTNET_CHAIN_ID,
          verifyingContract: ARC_TESTNET_USDC_ADDRESS
        }
      }),
      undefined
    );
    expect(decodeX402Header<X402PaymentPayload>(header).accepted).toEqual(usdcRequirement);
  });
});
