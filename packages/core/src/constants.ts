export const X402_VERSION = 2 as const;
export const BASE_NETWORK = "eip155:8453" as const;
export const BASE_CHAIN_ID = 8453 as const;
// Canonical Base mainnet USDC contract (lowercase for case-insensitive compares).
// h402 only signs EIP-3009 `exact` payments against this asset.
export const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
export const USDC_DECIMALS = 6 as const;
export const USDC_EIP712_NAME = "USD Coin" as const;
export const USDC_EIP712_VERSION = "2" as const;

export type X402Version = typeof X402_VERSION;
export type X402Network = typeof BASE_NETWORK;
export type UsdcDecimals = typeof USDC_DECIMALS;

/**
 * EIP-3009 `transferWithAuthorization` typed-data struct used for x402 `exact`
 * Base USDC payments. The signer plugs in separately (OWS on the CLI, viem on
 * the server); this is the shared message shape both sides agree on.
 */
export const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
} as const;
