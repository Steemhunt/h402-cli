import { BASE_NETWORK, type X402Network } from "./constants.js";
import type { X402PaymentRequired, X402PaymentRequirements } from "./types.js";

export type TransferAuthorization = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
};

// Web Crypto so the toolkit works in both Node (>=20) and browsers.
export function createNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build the EIP-3009 authorization fields (string-valued, signer-agnostic) for an
 * x402 `exact` payment. Each signer maps these into its own typed-data shape.
 * `now` is injectable for deterministic tests.
 */
export function buildTransferAuthorization(input: {
  from: `0x${string}`;
  to: `0x${string}`;
  amount: string;
  maxTimeoutSeconds: number;
  now?: number;
}): TransferAuthorization {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  return {
    from: input.from,
    to: input.to,
    value: input.amount,
    validAfter: String(now - 5),
    // Floor defensively: a fractional timeout from an upstream challenge would
    // produce a non-integer uint256 string that wallets reject.
    validBefore: String(now + Math.floor(input.maxTimeoutSeconds)),
    nonce: createNonce()
  };
}

/**
 * Select a supported `exact` payment requirement from an x402 challenge.
 * `matchAsset` / `rejectNativeTransfer` let the server pin Base USDC while the
 * CLI accepts any exact requirement on the network.
 */
export function selectExactRequirement(
  paymentRequired: X402PaymentRequired,
  options: {
    network?: X402Network;
    matchAsset?: (asset: string) => boolean;
    rejectNativeTransfer?: boolean;
  } = {}
): X402PaymentRequirements {
  const network = options.network ?? BASE_NETWORK;
  const accepted = paymentRequired.accepts.find(
    (candidate) =>
      candidate.scheme === "exact" &&
      candidate.network === network &&
      (!options.matchAsset || options.matchAsset(candidate.asset)) &&
      (!options.rejectNativeTransfer || candidate.extra?.assetTransferMethod !== "native")
  );
  if (!accepted) {
    throw new Error("No supported Base USDC exact x402 payment requirement was returned");
  }
  return accepted;
}
