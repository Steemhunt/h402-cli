import { randomBytes } from "node:crypto";
import { signOwsTypedData } from "./ows.js";

export const X402_HEADERS = {
  paymentRequired: "PAYMENT-REQUIRED",
  paymentSignature: "PAYMENT-SIGNATURE",
  paymentResponse: "PAYMENT-RESPONSE"
} as const;

const BASE_NETWORK = "eip155:8453";
const USDC_EIP712_NAME = "USD Coin";
const USDC_EIP712_VERSION = "2";

type X402PaymentRequirements = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

export type X402PaymentRequired = {
  x402Version: number;
  error?: string;
  accepts: X402PaymentRequirements[];
  extensions?: Record<string, unknown>;
};

function encodeX402Header(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeX402Header<T>(value: string) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
}

function createNonce() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function selectBaseUsdcExactRequirement(paymentRequired: X402PaymentRequired) {
  const accepted = paymentRequired.accepts.find((candidate) => candidate.scheme === "exact" && candidate.network === BASE_NETWORK);
  if (!accepted) {
    throw new Error("No supported Base USDC exact x402 payment requirement was returned");
  }
  return accepted;
}

export function paymentRequiredFromResponse(headers: Headers, body: unknown) {
  const header = headers.get(X402_HEADERS.paymentRequired);
  if (header) {
    return decodeX402Header<X402PaymentRequired>(header);
  }

  if (body && typeof body === "object" && "x402Version" in body && "accepts" in body) {
    return body as X402PaymentRequired;
  }

  return null;
}

export async function createPaymentSignatureHeader(input: {
  paymentRequired: X402PaymentRequired;
  walletAddress: string;
  walletName: string;
  passphrase: string;
}) {
  const accepted = selectBaseUsdcExactRequirement(input.paymentRequired);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: input.walletAddress,
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: String(now - 5),
    validBefore: String(now + accepted.maxTimeoutSeconds),
    nonce: createNonce()
  };

  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    domain: {
      name: USDC_EIP712_NAME,
      version: USDC_EIP712_VERSION,
      chainId: 8453,
      verifyingContract: accepted.asset
    },
    message: authorization
  };

  const signature = await signOwsTypedData(input.walletName, typedData, input.passphrase);
  return encodeX402Header({
    x402Version: 2,
    accepted,
    payload: {
      authorization,
      signature
    }
  });
}
