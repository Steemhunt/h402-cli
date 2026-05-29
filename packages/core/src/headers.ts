import { X402_VERSION } from "./constants.js";
import type { X402PaymentPayload, X402PaymentRequired } from "./types.js";

export const X402_HEADERS = {
  paymentRequired: "PAYMENT-REQUIRED",
  paymentSignature: "PAYMENT-SIGNATURE",
  paymentResponse: "PAYMENT-RESPONSE"
} as const;

export function encodeX402Header(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeX402Header<T>(value: string) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
}

/** Read an x402 `PAYMENT-REQUIRED` from a response header, falling back to the body. */
export function paymentRequiredFromResponse(headers: Headers, body: unknown): X402PaymentRequired | null {
  const header = headers.get(X402_HEADERS.paymentRequired);
  if (header) {
    return decodeX402Header<X402PaymentRequired>(header);
  }

  if (body && typeof body === "object" && "x402Version" in body && "accepts" in body) {
    return body as X402PaymentRequired;
  }

  return null;
}

export function parsePaymentRequiredHeader(value: string | null): X402PaymentRequired | null {
  if (!value) {
    return null;
  }

  try {
    const payload = decodeX402Header<X402PaymentRequired>(value);
    if (payload.x402Version !== X402_VERSION || !Array.isArray(payload.accepts)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parsePaymentSignatureHeader(value: string | null): X402PaymentPayload | null {
  if (!value) {
    return null;
  }

  try {
    const payload = decodeX402Header<X402PaymentPayload>(value);
    if (payload.x402Version !== X402_VERSION || payload.accepted?.scheme !== "exact") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
