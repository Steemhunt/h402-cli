import { X402_VERSION } from "./constants.js";
import type { X402PaymentPayload, X402PaymentRequired } from "./types.js";

export const X402_HEADERS = {
  paymentRequired: "PAYMENT-REQUIRED",
  paymentSignature: "PAYMENT-SIGNATURE",
  paymentResponse: "PAYMENT-RESPONSE"
} as const;

// btoa/atob + TextEncoder instead of Buffer so the codecs work in browsers too.
export function encodeX402Header(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeX402Header<T>(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Read an x402 `PAYMENT-REQUIRED` from a response header, falling back to the body. */
export function paymentRequiredFromResponse(headers: Headers, body: unknown): X402PaymentRequired | null {
  const header = headers.get(X402_HEADERS.paymentRequired);
  const parsedHeader = parsePaymentRequiredHeader(header);
  if (parsedHeader) {
    return parsedHeader;
  }

  if (body && typeof body === "object" && "x402Version" in body && "accepts" in body) {
    const payload = body as X402PaymentRequired;
    return payload.x402Version === X402_VERSION && Array.isArray(payload.accepts) ? payload : null;
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
