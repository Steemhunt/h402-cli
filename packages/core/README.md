# @h402/core

Open x402 / h402 protocol toolkit — the shared, dependency-light TypeScript layer
used by the [h402 CLI](../cli) and the h402 backend.

It is **signer-agnostic**: it builds the EIP-3009 `transferWithAuthorization`
typed-data and encodes/decodes x402 headers, but never signs and never verifies.
Each consumer plugs in its own signer (OWS in the CLI, viem on the server).

## Install

```bash
npm install @h402/core
```

## What's inside

- **Constants** — `X402_VERSION`, `BASE_NETWORK`, `BASE_CHAIN_ID`, USDC EIP-712 domain, and the `transferWithAuthorizationTypes` struct.
- **Types** — `X402PaymentRequired`, `X402PaymentRequirements`, `X402PaymentPayload`, `X402Settlement`, and the `h402-credit` / `h402-route` extensions.
- **Headers** — `encodeX402Header` / `decodeX402Header`, `paymentRequiredFromResponse`, `parsePaymentRequiredHeader`, `parsePaymentSignatureHeader`, plus the `X402_HEADERS` names.
- **EIP-3009** — `buildTransferAuthorization`, `createNonce`, `selectExactRequirement`.

## License

MIT
