import { describe, expect, it } from "vitest";
import {
  BASE_NETWORK,
  buildTransferAuthorization,
  createNonce,
  decodeX402Header,
  encodeX402Header,
  paymentRequiredFromResponse,
  parsePaymentRequiredHeader,
  parsePaymentSignatureHeader,
  selectExactRequirement,
  type X402PaymentRequired
} from "./index.js";

const baseRequirement = {
  scheme: "exact" as const,
  network: BASE_NETWORK,
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  amount: "50000",
  payTo: "0x1677383A7Bec2cf618FC98aeF68b757BcFc37F27",
  maxTimeoutSeconds: 120
};

const paymentRequired: X402PaymentRequired = {
  x402Version: 2,
  accepts: [baseRequirement]
};

describe("headers", () => {
  it("round-trips base64 JSON", () => {
    const encoded = encodeX402Header(paymentRequired);
    expect(decodeX402Header<X402PaymentRequired>(encoded)).toEqual(paymentRequired);
  });

  it("reads PAYMENT-REQUIRED from a header", () => {
    const headers = new Headers({ "PAYMENT-REQUIRED": encodeX402Header(paymentRequired) });
    expect(paymentRequiredFromResponse(headers, null)).toEqual(paymentRequired);
  });

  it("falls back to the response body", () => {
    expect(paymentRequiredFromResponse(new Headers(), paymentRequired)).toEqual(paymentRequired);
  });

  it("ignores malformed PAYMENT-REQUIRED headers instead of throwing raw decoder errors", () => {
    const headers = new Headers({ "PAYMENT-REQUIRED": "not base64" });
    expect(paymentRequiredFromResponse(headers, { error: "bad challenge" })).toBeNull();
  });

  it("falls back to a valid body when the PAYMENT-REQUIRED header is malformed", () => {
    const headers = new Headers({ "PAYMENT-REQUIRED": "not base64" });
    expect(paymentRequiredFromResponse(headers, paymentRequired)).toEqual(paymentRequired);
  });

  it("rejects malformed required/signature headers", () => {
    expect(parsePaymentRequiredHeader(null)).toBeNull();
    expect(parsePaymentRequiredHeader(encodeX402Header({ x402Version: 1 }))).toBeNull();
    expect(parsePaymentSignatureHeader(encodeX402Header({ x402Version: 2, accepted: { scheme: "x" } }))).toBeNull();
  });
});

describe("selectExactRequirement", () => {
  it("returns the matching Base USDC exact requirement", () => {
    expect(selectExactRequirement(paymentRequired)).toEqual(baseRequirement);
  });

  it("honors an asset matcher", () => {
    expect(() => selectExactRequirement(paymentRequired, { matchAsset: () => false })).toThrow();
  });

  it("requireEip3009 rejects native, permit2, and other explicit non-eip3009 methods", () => {
    for (const assetTransferMethod of ["native", "permit2", "other"]) {
      const challenge: X402PaymentRequired = { x402Version: 2, accepts: [{ ...baseRequirement, extra: { assetTransferMethod } }] };
      expect(() => selectExactRequirement(challenge, { requireEip3009: true })).toThrow();
    }
  });

  it("requireEip3009 accepts an explicit eip3009 method, an absent method, and scans past unsupported entries", () => {
    const eip3009 = { ...baseRequirement, extra: { assetTransferMethod: "eip3009" } };
    expect(selectExactRequirement({ x402Version: 2, accepts: [eip3009] }, { requireEip3009: true })).toEqual(eip3009);
    // An absent method is the default EIP-3009 shape.
    expect(selectExactRequirement(paymentRequired, { requireEip3009: true })).toEqual(baseRequirement);
    // A permit2 entry is skipped in favor of a later valid eip3009 entry.
    const permit2 = { ...baseRequirement, extra: { assetTransferMethod: "permit2" } };
    expect(selectExactRequirement({ x402Version: 2, accepts: [permit2, eip3009] }, { requireEip3009: true })).toEqual(eip3009);
  });
});

describe("buildTransferAuthorization", () => {
  it("derives the validity window from a fixed clock", () => {
    const authorization = buildTransferAuthorization({
      from: "0xfrom000000000000000000000000000000000000",
      to: "0xto00000000000000000000000000000000000000",
      amount: "50000",
      maxTimeoutSeconds: 120,
      now: 1_000
    });
    expect(authorization.validAfter).toBe("940");
    expect(Number(authorization.validBefore) - Number(authorization.validAfter)).toBe(180);
    expect(authorization.validBefore).toBe("1120");
    expect(authorization.value).toBe("50000");
    expect(authorization.nonce).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("floors fractional timeouts so uint256 strings stay integral", () => {
    const authorization = buildTransferAuthorization({
      from: "0xfrom000000000000000000000000000000000000",
      to: "0xto00000000000000000000000000000000000000",
      amount: "50000",
      maxTimeoutSeconds: 1617.5364150211697,
      now: 1_000
    });
    expect(authorization.validBefore).toBe("2617");
  });

  it("creates unique 32-byte nonces", () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
