# @h402/core

[![npm](https://img.shields.io/npm/v/%40h402%2Fcore?label=%40h402%2Fcore)](https://www.npmjs.com/package/@h402/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Open x402 / h402 protocol toolkit — the shared, dependency-light TypeScript layer used by the [h402 CLI](../cli) and the h402 backend.

It is **signer-agnostic**: it builds the EIP-3009 `transferWithAuthorization` typed-data and encodes/decodes x402 headers, but never signs and never verifies. Each consumer plugs in its own signer (OWS in the CLI, viem on the server). Browser-safe — uses Web Crypto, no Node `Buffer`.

## Install

```bash
npm install @h402/core
```

## What's inside

- **Constants** — `X402_VERSION`, `BASE_NETWORK`, `BASE_CHAIN_ID`, the USDC EIP-712 domain (`USDC_EIP712_NAME`, `USDC_EIP712_VERSION`, `USDC_DECIMALS`), and the `transferWithAuthorizationTypes` struct.
- **Types** — `X402PaymentRequired`, `X402PaymentRequirements`, `X402PaymentPayload`, `X402Settlement`, and the `h402-credit` / `h402-route` extensions.
- **Headers** — `encodeX402Header` / `decodeX402Header`, `paymentRequiredFromResponse`, `parsePaymentRequiredHeader`, `parsePaymentSignatureHeader`, plus the `X402_HEADERS` names.
- **EIP-3009** — `buildTransferAuthorization`, `createNonce`, `selectExactRequirement`.

## Usage

Given an x402 `402 PAYMENT-REQUIRED` challenge, build a Base USDC authorization, sign it with any EIP-712 signer, and encode the `PAYMENT-SIGNATURE` header:

```ts
import {
  selectExactRequirement,
  buildTransferAuthorization,
  encodeX402Header,
  X402_VERSION,
  type X402PaymentRequired
} from "@h402/core";

// `challenge` comes from the 402 response (PAYMENT-REQUIRED header or body).
function payment(challenge: X402PaymentRequired, from: `0x${string}`, signTypedData: (td: unknown) => Promise<string>) {
  const requirement = selectExactRequirement(challenge); // the Base USDC "exact" requirement
  const authorization = buildTransferAuthorization({
    from,
    to: requirement.payTo,
    amount: requirement.amount,            // 6-decimal USDC, e.g. "50000" = $0.05
    maxTimeoutSeconds: requirement.maxTimeoutSeconds
  });

  // Sign EIP-712 transferWithAuthorization with your own signer (OWS, viem, ethers…).
  // const signature = await signTypedData({ types: transferWithAuthorizationTypes, ... });

  return async () => {
    const signature = await signTypedData(authorization);
    return encodeX402Header({ x402Version: X402_VERSION, accepted: requirement, payload: { authorization, signature } });
  };
}
```

The CLI ([`@h402/cli`](../cli)) wires this to the OWS signer; the h402 backend verifies the same payload with viem.

## License

MIT
