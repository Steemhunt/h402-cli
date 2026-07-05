# h402

[![CI](https://github.com/Steemhunt/h402-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Steemhunt/h402-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40h402%2Fcore?label=%40h402%2Fcore)](https://www.npmjs.com/package/@h402/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Base · x402](https://img.shields.io/badge/Base-x402-fc6f6f.svg)](https://x402.org)

Open-source toolkit for **h402 — the x402 router for agent capabilities**. One endpoint per task: h402 routes each call to the best API provider and settles per call in Base USDC over x402.

> x402 is the rail. h402 is the router.

- **Browse capabilities** → https://h402.hunt.town/catalog
- **Docs & agent quickstart** → https://h402.hunt.town/docs
- **AI agents** → point yours at [`SKILL.md`](./SKILL.md): it can create a wallet, fund it with Base USDC, and start calling tools with no per-provider keys.

## Packages

| Package | Description |
| --- | --- |
| [`@h402/core`](./packages/core) | Dependency-light TypeScript protocol toolkit: x402 types, header codecs, and the EIP-3009 typed-data builder. Signer-agnostic. |
| [`@h402/cli`](./packages/cli) | Local, non-custodial CLI: manage a wallet, browse the catalog, quote, and pay-per-call against an h402 backend. |

## Quickstart

```bash
npm install -g @h402/cli

# A local, non-custodial wallet (keys stay on your machine; passphrase-less by default):
h402 wallet create --name agent
# Fund it with a few dollars of Base USDC — send to the printed address,
# or run: h402 wallet fund --name agent

h402 search "web search"
h402 call web/search --name agent --json '{"query":"agent payments"}'
```

The CLI targets the production backend (`https://h402.hunt.town`) by default; set `H402_API_URL` or `--api-url` only when pointing at another backend such as local dev.

The CLI signs locally through the [Open Wallet Standard](https://github.com/open-wallet-standard) and bundles the `ows` wallet binary, so a global install is self-contained — no separate wallet install needed. Override it with `H402_OWS_BIN` to use your own build.

## How it works

You call a task (`category/action`); the proxy answers with an x402 `402 PAYMENT-REQUIRED`; the CLI signs a Base USDC EIP-3009 authorization locally and retries — you pay the exact per-call price and get a canonical JSON response. Keys never leave your machine.

A successful `call` prints `{ "data": <provider result>, "meta"?: <pagination/provider metadata>, "h402": <routing metadata> }`: the upstream provider's JSON is under `data`, optional `meta` carries pagination/provider metadata when present, and `h402` carries the resolved `provider`, `selectedCandidateId`, `routing`, `paidBy`, `ledgerEntryId`, `paymentTransaction`, and async `followUp` poll hints. On failure the CLI exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr — `message` is a human-readable diagnostic, and `detail` carries the backend's JSON error when the request reached the backend.

> `web/search` accepts `limit` as a common canonical field on the default `auto` route. Truly provider-specific fields on other routes still require pinning the owning provider with `--provider`; otherwise auto-routing rejects the request.

## Development

```bash
npm install        # install all workspaces
npm run build      # build every package
npm run typecheck  # tsc --noEmit across packages
npm run lint       # eslint across packages
npm test           # vitest across packages
```

Node 22+. ESM throughout.

## Releasing

**Publish `@h402/core` before `@h402/cli`.** `@h402/cli` depends on `@h402/core` as a registry dependency, so core must be available on npm first or a clean `npm install -g @h402/cli` will fail to resolve it.

Before publishing, verify and smoke-test the packed artifacts:

```bash
npm run verify:pack   # each tarball ships its compiled dist
npm run smoke:pack    # pack core+cli, install both into a clean project, run `h402 --help`
```

Each package's `prepack` builds `dist` automatically on `npm pack` / `npm publish`; `verify:pack` asserts the tarball contents so a clean checkout can never publish a package without its JS/types. `smoke:pack` goes further — it installs the packed core + cli into a throwaway prefix and runs `h402 --help`, catching install/entrypoint breakage (an unresolvable `@h402/core`, a broken bin) that an in-repo build would hide. (It runs only `--help`, so it does not cover OWS-binary resolution.) Both run in CI.

## License

MIT
