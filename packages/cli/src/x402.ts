import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
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

export { X402_HEADERS, paymentRequiredFromResponse, type X402PaymentRequired } from "@h402/core";

// The CLI can only sign EIP-3009 Base USDC `exact` payments, so it must refuse to
// sign anything else a backend offers — a non-USDC asset or a native transfer
// would move funds the user never agreed to. Pin the selection to Base USDC.
export const BASE_USDC_REQUIREMENT_OPTIONS = {
  matchAsset: (asset: string) => asset.toLowerCase() === BASE_USDC_ADDRESS,
  rejectNativeTransfer: true
} as const;

export async function createPaymentSignatureHeader(input: {
  paymentRequired: X402PaymentRequired;
  walletAddress: string;
  walletName: string;
  passphrase?: string;
}) {
  const accepted = selectExactRequirement(input.paymentRequired, BASE_USDC_REQUIREMENT_OPTIONS);
  const authorization = buildTransferAuthorization({
    from: input.walletAddress as `0x${string}`,
    to: accepted.payTo as `0x${string}`,
    amount: accepted.amount,
    maxTimeoutSeconds: accepted.maxTimeoutSeconds
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
      chainId: BASE_CHAIN_ID,
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
