export const X402_VERSION = 2 as const;
export const ARC_TESTNET_NETWORK = "eip155:5042002" as const;
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
// Canonical Arc Testnet USDC contract (lowercase for case-insensitive compares).
// h402 only signs EIP-3009 `exact` payments against this asset.
export const ARC_TESTNET_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6 as const;
export const USDC_EIP712_NAME = "USDC" as const;
export const USDC_EIP712_VERSION = "2" as const;

export type X402Version = typeof X402_VERSION;
// Upstream x402 challenges can use any network. CLI selectors still pin the
// exact Arc Testnet CAIP-2 identifier before signing.
export type X402Network = string;
export type UsdcDecimals = typeof USDC_DECIMALS;

/**
 * EIP-3009 `transferWithAuthorization` typed-data struct used for x402 `exact`
 * USDC payments. The signer plugs in separately (OWS on the CLI, viem on the
 * server); this is the shared message shape both sides agree on.
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
