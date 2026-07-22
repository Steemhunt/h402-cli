# h402

[![CI](https://github.com/Steemhunt/h402-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Steemhunt/h402-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40h402%2Fcore?label=%40h402%2Fcore)](https://www.npmjs.com/package/@h402/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Base · x402](https://img.shields.io/badge/Base-x402-fc6f6f.svg)](https://x402.org)

Open-source toolkit for **h402 — the x402 capability store for agents**. Discover a task, inspect its enabled providers and provider-native contracts, then execute one concrete provider path with Base USDC settlement when required.

> x402 is the payment rail. h402 is the capability store and execution surface.

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

h402 search "web search"                              # compact route/provider summaries
h402 show web/search                                    # full route + all provider contracts
h402 show web/search --provider stableenrich-exa        # one full provider-native contract
h402 quote web/search --provider stableenrich-exa --json '{"query":"agent payments"}'
h402 call ai/news                                      # free; omitted provider resolves defaultProvider

# Set up a signer only when you want to call a route that returns a payable 402:
h402 wallet list                                       # read-only native-binding preflight; [] is OK
h402 wallet create --name agent
h402 wallet fund --name agent
h402 call web/search --provider stableenrich-exa --name agent --json '{"query":"agent payments"}'
```

Browsing, quoting, and free-route calls do not require a local wallet. Wallet creation creates a local signing wallet only; `h402 auth` creates the optional bonus-credit session. A funded local wallet is required only if the first response is a payable `402`.

The CLI targets the production backend (`https://h402.hunt.town`) by default; set `H402_API_URL` or `--api-url` only when pointing at another backend such as local dev.

The CLI signs locally through [Open Wallet Standard](https://github.com/open-wallet-standard) core, whose wallet and signing methods lazy-load a platform package.

OWS wallet creation and signing use native bindings available only on macOS and glibc-based Linux, on x64 or arm64. Windows, musl/Alpine, and other OS/architecture combinations can still run `--help`, `search`, `quote`, and free-route `call`, but cannot create, list, restore, or auto-adopt wallets, run `h402 auth`, or sign a payable call until OWS ships a matching native binding. `wallet address`, `wallet balance`, and `wallet fund` keep working for wallets already mapped in `~/.h402/config.json` — but USDC funded from an unsupported host can only be spent by signing on a supported platform. Before creating or funding a wallet, run `h402 wallet list` as a read-only native-binding preflight.

## How it works

Each call uses one concrete provider. Without `--provider`, the CLI resolves the route's current `defaultProvider` from full catalog detail before sending the call. The result includes `h402.cliProviderSelection` with the selected provider and a reproducible pinned command; passing `--provider` skips default resolution and calls that pinned path directly. A `410` response is never retried automatically: read its machine-readable alternatives, inspect the replacement with `h402 show`, then start a new explicit call.

After provider resolution, the CLI sends the request before resolving a wallet. An initial 2xx is returned directly — `h402.paidBy` says whether it was `free` (no charge) or covered by bonus `credit` from an authenticated session. Only when the first response is an x402 `402 PAYMENT-REQUIRED` does the CLI resolve a funded local wallet, sign a Base USDC EIP-3009 authorization locally, and retry the same pinned provider path. Pass `--max-usd <amount>` (or store a string `maxUsd`, such as `"0.05"`, in `~/.h402/config.json`) to refuse signing a challenge above that USDC cap. Keys never leave your machine.

A successful `call` prints `{ "data": <provider-native body>, "h402": <execution metadata> }`: `data` stays provider-native, while `h402` carries the provider-pinned execution receipt plus CLI-added `cliProviderSelection`. `ledgerEntryId` is present for credit or x402-paid calls; `paymentTransaction` and CLI-added `signedAmount` are x402-payment-only fields; free calls omit all three. Optional `h402.followUp` instructions describe async work. On failure the CLI exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr — `message` is human-readable and `detail` preserves machine-readable backend recovery fields such as alternatives.

Async routes may return a job receipt instead of the final result. Async parent route IDs end in `-async`; a single-parent follow-up is `<parent-route>-status`, while shared multi-parent follow-ups may use a shared `*-status` name. When `h402.followUp` is present, follow its provider-native `params` object together with `method`, `path`, `docsUrl`, and `instruction` until the provider reports completion. The follow-up path is provider-bound, so preserve its provider segment. Match `followUp.method` — GET params go via `--query`, POST bodies via `--json`; the CLI rejects `--query` on a POST (`<followUp.params>` means its JSON-encoded object):

```bash
# followUp.method GET (most status polls):
h402 call <followUp.routeId> \
  --provider <provider-from-followUp.path> \
  --query '<followUp.params>'

# followUp.method POST (e.g. ai/music-generate-async-status):
h402 call <followUp.routeId> \
  --provider <provider-from-followUp.path> \
  --json '<followUp.params>'
```

`h402 search` returns compact route/provider summaries. Use `h402 show <route>` for full provider-native schemas and samples, then pin a provider for reproducibility.

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
