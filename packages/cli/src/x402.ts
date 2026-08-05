import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  ARC_TESTNET_USDC_ADDRESS,
  USDC_EIP712_NAME,
  USDC_EIP712_VERSION,
  X402_VERSION,
  buildTransferAuthorization,
  encodeX402Header,
  selectExactRequirement,
  transferWithAuthorizationTypes,
  type X402PaymentRequired
} from "@h402/core";
import { signOwsTypedData } from "./ows.js";

export { X402_HEADERS, paymentRequiredFromResponse } from "@h402/core";

// The CLI can only sign EIP-3009 Arc Testnet USDC `exact` payments, so it must refuse to
// sign anything else a backend offers — a non-USDC asset or a non-EIP-3009
// transfer method (native, permit2, ...) would move funds in a way the user never
// agreed to. The asset matcher is defensive: a malformed (non-string) asset is a
// clean non-match, not a thrown error that would abort scanning valid entries.
export const ARC_TESTNET_USDC_REQUIREMENT_OPTIONS = {
  network: ARC_TESTNET_NETWORK,
  matchAsset: (asset: unknown) => typeof asset === "string" && asset.toLowerCase() === ARC_TESTNET_USDC_ADDRESS,
  requireEip3009: true
} as const;

export function selectArcTestnetUsdcRequirement(paymentRequired: X402PaymentRequired) {
  return selectExactRequirement(paymentRequired, ARC_TESTNET_USDC_REQUIREMENT_OPTIONS);
}

export async function createPaymentSignatureHeader(input: {
  paymentRequired: X402PaymentRequired;
  walletAddress: string;
  walletName: string;
  passphrase?: string;
  authorizationNow?: number;
}) {
  const accepted = selectArcTestnetUsdcRequirement(input.paymentRequired);
  const authorization = buildTransferAuthorization({
    from: input.walletAddress as `0x${string}`,
    to: accepted.payTo as `0x${string}`,
    amount: accepted.amount,
    maxTimeoutSeconds: accepted.maxTimeoutSeconds,
    now: input.authorizationNow
  });

  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      ...transferWithAuthorizationTypes
    },
    primaryType: "TransferWithAuthorization",
    domain: {
      name: USDC_EIP712_NAME,
      version: USDC_EIP712_VERSION,
      chainId: ARC_TESTNET_CHAIN_ID,
      verifyingContract: accepted.asset
    },
    message: authorization
  };

  const signature = await signOwsTypedData(input.walletName, typedData, input.passphrase);
  return encodeX402Header({
    x402Version: X402_VERSION,
    accepted,
    payload: {
      authorization,
      signature
    }
  });
}
