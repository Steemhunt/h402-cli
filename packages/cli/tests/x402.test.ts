import { beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_NETWORK, BASE_USDC_ADDRESS, decodeX402Header, selectExactRequirement, type X402PaymentPayload, type X402PaymentRequired } from "@h402/core";
import { BASE_USDC_REQUIREMENT_OPTIONS, createPaymentSignatureHeader } from "../src/x402";

const { signOwsTypedData } = vi.hoisted(() => ({
  signOwsTypedData: vi.fn(async () => `0x${"11".repeat(65)}`)
}));
vi.mock("../src/ows.js", () => ({ signOwsTypedData }));

const usdcRequirement = {
  scheme: "exact" as const,
  network: BASE_NETWORK,
  asset: BASE_USDC_ADDRESS,
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

describe("BASE_USDC_REQUIREMENT_OPTIONS", () => {
  it("pins the canonical Base mainnet USDC contract", () => {
    expect(BASE_USDC_ADDRESS).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("accepts a Base USDC exact requirement (case-insensitive asset)", () => {
    const accepted = selectExactRequirement(
      challenge({ ...usdcRequirement, asset: BASE_USDC_ADDRESS.toUpperCase() }),
      BASE_USDC_REQUIREMENT_OPTIONS
    );
    expect(accepted.asset).toBe(BASE_USDC_ADDRESS.toUpperCase());
  });

  it("rejects a non-USDC asset", () => {
    expect(() =>
      selectExactRequirement(challenge({ ...usdcRequirement, asset: "0xdeadbeef00000000000000000000000000000000" }), BASE_USDC_REQUIREMENT_OPTIONS)
    ).toThrow(/only signs Base USDC/);
  });

  it("rejects non-eip3009 transfer methods on the USDC asset (native, permit2)", () => {
    for (const assetTransferMethod of ["native", "permit2"]) {
      expect(() =>
        selectExactRequirement(challenge({ ...usdcRequirement, extra: { assetTransferMethod } }), BASE_USDC_REQUIREMENT_OPTIONS)
      ).toThrow(/only signs Base USDC/);
    }
  });

  it("accepts an explicit eip3009 method", () => {
    const accepted = selectExactRequirement(challenge({ ...usdcRequirement, extra: { assetTransferMethod: "eip3009" } }), BASE_USDC_REQUIREMENT_OPTIONS);
    expect(accepted.asset).toBe(BASE_USDC_ADDRESS);
  });

  it("rejects a requirement on the wrong network", () => {
    expect(() =>
      selectExactRequirement(challenge({ ...usdcRequirement, network: "eip155:1" }), BASE_USDC_REQUIREMENT_OPTIONS)
    ).toThrow(/only signs Base USDC/);
  });

  it("ignores a malformed (non-string) asset entry and still selects the valid USDC one", () => {
    const accepted = selectExactRequirement(
      { x402Version: 2, accepts: [{ ...usdcRequirement, asset: null }, usdcRequirement] } as unknown as X402PaymentRequired,
      BASE_USDC_REQUIREMENT_OPTIONS
    );
    expect(accepted.asset).toBe(BASE_USDC_ADDRESS);
  });
});

describe("createPaymentSignatureHeader guards", () => {
  beforeEach(() => signOwsTypedData.mockClear());

  it("refuses to sign a non-USDC challenge before touching the wallet", async () => {
    await expect(
      createPaymentSignatureHeader({ paymentRequired: challenge({ ...usdcRequirement, asset: "0xdeadbeef00000000000000000000000000000000" }), ...DUMMY })
    ).rejects.toThrow(/only signs Base USDC/);
    expect(signOwsTypedData).not.toHaveBeenCalled();
  });

  it("refuses to sign a native-transfer challenge", async () => {
    await expect(
      createPaymentSignatureHeader({ paymentRequired: challenge({ ...usdcRequirement, extra: { assetTransferMethod: "native" } }), ...DUMMY })
    ).rejects.toThrow(/only signs Base USDC/);
    expect(signOwsTypedData).not.toHaveBeenCalled();
  });

  it("refuses to sign a wrong-network challenge", async () => {
    await expect(
      createPaymentSignatureHeader({ paymentRequired: challenge({ ...usdcRequirement, network: "eip155:1" }), ...DUMMY })
    ).rejects.toThrow(/only signs Base USDC/);
    expect(signOwsTypedData).not.toHaveBeenCalled();
  });

  it("caps the signed authorization while retaining the original quoted requirement", async () => {
    const accepted = { ...usdcRequirement, maxTimeoutSeconds: 1_791_788_437, extra: { assetTransferMethod: "eip3009" } };
    const paymentRequired: X402PaymentRequired = {
      ...challenge(accepted),
      resource: { url: "https://provider.test/tool", mimeType: "application/json" },
      extensions: { example: { reference: "quoted-context" } }
    };
    const original = structuredClone(paymentRequired);
    const header = await createPaymentSignatureHeader({ paymentRequired, ...DUMMY, authorizationNow: 1_000 });
    const payload = decodeX402Header<X402PaymentPayload>(header);

    expect(payload.accepted).toEqual(accepted);
    expect(paymentRequired).toEqual(original);
    expect(payload.payload.authorization).toMatchObject({
      from: DUMMY.walletAddress,
      to: accepted.payTo,
      value: accepted.amount,
      validAfter: "940",
      validBefore: "1720",
      nonce: expect.stringMatching(/^0x[a-f0-9]{64}$/)
    });
    expect(signOwsTypedData).toHaveBeenCalledTimes(1);
    expect(signOwsTypedData).toHaveBeenCalledWith(
      DUMMY.walletName, expect.objectContaining({ message: payload.payload.authorization }), undefined
    );
  });
});
