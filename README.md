# h402

[![CI](https://github.com/hunt-town/h402/actions/workflows/ci.yml/badge.svg)](https://github.com/hunt-town/h402/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40h402%2Fcore?label=%40h402%2Fcore)](https://www.npmjs.com/package/@h402/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Base · x402](https://img.shields.io/badge/Base-x402-fc6f6f.svg)](https://x402.org)

Open-source toolkit for **h402 — the x402 router for agent capabilities**. One endpoint per task: h402 routes each call to the best API provider and settles per call in Base USDC over x402.

> x402 is the rail. h402 is the router.

This repository is an npm-workspaces monorepo with two packages:

| Package | Description |
| --- | --- |
| [`@h402/core`](./packages/core) | Dependency-light TypeScript protocol toolkit: x402 types, header codecs, and the EIP-3009 typed-data builder. Signer-agnostic. |
| [`@h402/cli`](./packages/cli) | Local, non-custodial CLI: manage a wallet, browse the catalog, quote, and pay-per-call against an h402 backend. |

## Quickstart

```bash
npm install
npm run build

# Use the CLI
npm run -w @h402/cli dev -- quote web/search --json '{"query":"agent APIs"}'
```

## Development

```bash
npm install        # install all workspaces
npm run build      # build every package
npm run typecheck  # tsc --noEmit across packages
npm run lint       # eslint across packages
npm test           # vitest across packages
```

Node 22+. ESM throughout.

## License

MIT
