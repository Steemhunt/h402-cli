# @h402/cli

[![npm](https://img.shields.io/npm/v/%40h402%2Fcli?label=%40h402%2Fcli)](https://www.npmjs.com/package/@h402/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Local, non-custodial CLI for [h402](../../README.md) — the x402 capability store for agents. Search compact summaries, inspect provider-native contracts, execute one concrete provider path, and pay from a local wallet only when challenged over x402. **Private keys never leave your machine.**

Building an AI agent? See [`SKILL.md`](../../SKILL.md) for an agent-ready walkthrough.

## Install

```bash
npm install -g @h402/cli
```

> The CLI uses [Open Wallet Standard](https://github.com/open-wallet-standard) core, whose wallet and signing methods lazy-load a platform package.
>
> OWS wallet creation and signing use native bindings available only on macOS and glibc-based Linux, on x64 or arm64. Windows, musl/Alpine, and other OS/architecture combinations can still run `--help`, `search`, `quote`, and free-route `call`, but cannot create, list, restore, or auto-adopt wallets, run `h402 auth`, or sign a payable call until OWS ships a matching native binding. `wallet address`, `wallet balance`, and `wallet fund` keep working for wallets already mapped in `~/.h402/config.json` — but USDC funded from an unsupported host can only be spent by signing on a supported platform. Before creating or funding a wallet, run `h402 wallet list` as a read-only native-binding preflight.

## Quickstart

```bash
h402 search "web search"                              # compact wallet-free summaries
h402 show web/search                                   # full route + provider contracts
h402 show web/search --provider stableenrich-exa       # one full native contract
h402 quote web/search --provider stableenrich-exa --json '{"query":"agent APIs"}'
h402 call ai/news                                      # free; omitted provider resolves defaultProvider

# Only for routes that answer with a payable 402:
h402 wallet list                                     # read-only native-binding preflight; [] is OK
h402 wallet create --name agent                      # local signing wallet
h402 wallet fund --name agent                        # Base USDC address + instructions
h402 call web/search --provider stableenrich-exa --name agent --json '{"query":"agent APIs"}'
```

Browsing, quoting, and free-route calls do not require a local wallet. Wallet creation creates a local signing wallet only; `h402 auth` creates the optional bonus-credit session. A funded local wallet is required only if the first response is a payable `402`.

Calls hit the production backend (`https://h402.hunt.town`) by default — override with `--api-url` or `H402_API_URL` (e.g. `http://localhost:3000` for local dev).

## Commands

| Command | Description |
| --- | --- |
| `h402 wallet create --name <n>` | Create a local OWS signing wallet (does not create an auth session; prints its address) |
| `h402 wallet list` | List OWS wallets |
| `h402 wallet restore` | Re-adopt OWS wallets into `~/.h402/config.json` |
| `h402 wallet address --name <n>` | Print the wallet address |
| `h402 wallet balance --name <n>` | Show the wallet's structured Base USDC balance |
| `h402 wallet fund --name <n>` | Print the Base USDC deposit address and funding instructions |
| `h402 auth --name <n>` | Create an optional backend bonus-credit session with a wallet signature |
| `h402 credits` | Show the bonus-credit balance for the signed-in session |
| `h402 search <query>` | Search compact route/provider summaries |
| `h402 show <category/action> [--provider <name>]` | Fetch full route or one provider-native contract |
| `h402 quote <category/action>` | Preview the x402 `PAYMENT-REQUIRED` envelope without paying |
| `h402 call <category/action>` | Execute a route and pay if challenged; free routes need no wallet |

Run `h402 --help`, `h402 <command> --help`, or `h402 wallet <subcommand> --help` for usage and flags, and `h402 --version` for the version. Unknown flags and unknown commands fail with a non-zero exit.

## Flags

| Flag | Applies to | Description |
| --- | --- | --- |
| `--name <wallet>` | wallet create/address/balance/fund; auth; call | Wallet to use (default `h402`) |
| `--wallet 0x...` | wallet address/balance/fund; auth; call | Sign with the local wallet that owns this address (must exist locally; must agree with `--name` if both are passed) |
| `--api-url <url>` | auth, credits, search, show, quote, call | Backend base URL override (or `H402_API_URL`; default `https://h402.hunt.town`) |
| `--json '{...}'` | quote, call | Request body (sets method to POST) |
| `--query '{...}'` | quote, call | URL query params (GET); values must be strings/numbers/booleans |
| `--provider <name>` | show, quote, call | Select a concrete provider; quote/call omission resolves the catalog default, while show omission lists all enabled providers |
| `--method GET\|POST` | quote, call | Override the method (inferred from `--json` otherwise) |
| `--passphrase [<s>]` | wallet create, auth, call | Passphrase for a passphrase-protected wallet; omit the value to be prompted (or `H402_WALLET_PASSPHRASE`) |
| `--no-passphrase` | wallet create, auth, call | Force passphrase-less signing even if `H402_WALLET_PASSPHRASE` is set (the default needs no flag) |
| `--no-credit` | call | Ignore bonus credits and pay x402 only |
| `--max-usd <usd>` | call | Optional client-side cap; refuse to sign if the quoted Base USDC amount exceeds it |
| `--idempotency-key <uuid>` | call | Stable key for safe retries (default: random) |
| `--limit <n>` | search | Max results (default `20`) |

Route ids are `category/action`, e.g. `web/search`, `maps/place-details`, `finance/stock-quote`. `--query` takes one scalar value per key (string, number, or boolean); pass arrays, nested objects, or request bodies with `--json` instead.

## How a call works

Each call uses one concrete provider. Without `--provider`, the CLI resolves the route's current `defaultProvider` from `/api/catalog/routes/<route>` before any execution request; explicit `--provider` goes straight to that pinned path. Every success includes `h402.cliProviderSelection` with the source, provider, and reproducible pinned command. A `410` response is never retried automatically — inspect its machine-readable alternatives with `h402 show`, then start a new explicit call.

```
h402 call web/search --json '{"query":"..."}'
   │
   ├─ resolve defaultProvider from full route detail
   ├─ request /routes/<provider>/web/search (before wallet resolution)
   ├─ 2xx → returned directly; h402.paidBy says free or credit
   └─ payable 402 → resolve wallet, sign Base USDC locally, then retry that same pinned request
```

If a route returns a payable 402, you're charged the exact per-call price (most paid
routes are $0.001–$0.05). An initial 2xx is returned directly — `h402.paidBy` says whether it was `free` (no charge) or covered by bonus `credit` from an authenticated session. Run `h402 quote`
first to see a payable route's price without paying. Pass `--max-usd <amount>` on
`call` (or store a string `maxUsd`, such as `"0.05"`, in `~/.h402/config.json`)
to refuse signing a challenge above that USDC cap. Paid call output includes `h402.signedAmount` so agents
can record the amount they signed. The CLI uses the first 402 response's `Date` header
when building the EIP-3009 validity window, reducing client clock-skew failures on paid
calls. If you've run `h402 auth`, bonus credits are drawn before USDC unless you pass
`--no-credit`.

`--idempotency-key` is double-charge protection, not result replay. If the server reports
`payment_settlement_pending`, the running CLI resends the exact `PAYMENT-SIGNATURE`, key,
method, path, provider, and body for bounded reconciliation attempts. One CLI invocation
creates at most one payment authorization: server-issued replacement challenges are
refused, and a separate explicit call is required to create a new payment. The CLI does
not persist payment signatures, so after the process exits it cannot reconstruct the
original signed request. Pending, reconciled, network, and gateway errors after a signed
send warn that settlement may still have occurred; only a matching
`payment_settlement_failed` response with `paid: false` and `safeToStartNewCall: true`
confirms that the original authorization was not paid.

## Agents & automation

Every command prints JSON to stdout — `search`, `show`, `quote`, `call`, `auth`, `credits`, and `wallet create`/`list`/`restore`/`address`/`balance`/`fund`.

A successful `call` is wrapped as `{ "data": <provider-native body>, "h402": <execution metadata> }` — `data` remains provider-native, and `h402` includes the provider-pinned execution receipt plus CLI-added `cliProviderSelection`. `ledgerEntryId` is present for credit or x402-paid calls; `paymentTransaction` and CLI-added `signedAmount` are x402-payment-only fields; free calls omit all three. Optional `h402.followUp` describes async work. A failed call exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr; `detail` preserves machine-readable route/provider alternatives.

Async routes may return a job receipt instead of the final result. Async parent route IDs end in `-async`; a single-parent follow-up is `<parent-route>-status`, while shared multi-parent follow-ups may use a shared `*-status` name. When `h402.followUp` is present, pass its provider-native `params` object according to `method` and preserve the provider segment from `path`. Match `followUp.method` — GET params go via `--query`, POST bodies via `--json`; the CLI rejects `--query` on a POST (`<followUp.params>` means its JSON-encoded object):

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

`h402 search` intentionally returns compact summaries. Fetch full schemas, request examples, and provider-native samples with `h402 show <route>` before pinning.

```bash
h402 search "token holders"                        # compact JSON to stdout
h402 show crypto/token-holders --provider nansen     # full native schema/sample
h402 call crypto/token-holders --provider nansen --name agent \
  --json '{"chain":"base","token_address":"0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913"}' # JSON result, non-zero exit on failure
```

Signing needs no flags for the default passphrase-less wallets. Only when a wallet was created with an opt-in passphrase, `export H402_WALLET_PASSPHRASE=...` (or pass `--passphrase <s>`) — the CLI tells you exactly this when it hits such a wallet non-interactively.

## Environment

| Variable | Purpose |
| --- | --- |
| `H402_API_URL` | Backend base URL override (or `--api-url`; default `https://h402.hunt.town`) |
| `H402_WALLET_PASSPHRASE` | Passphrase for passphrase-protected wallets (only needed when the wallet was created with one) |

Passphrases are never stored. Wallets are passphrase-less by default; opt in at create time (`--passphrase <s>`, or bare `--passphrase` to be prompted) when a wallet guards meaningful funds. The CLI persists only the backend URL, session tokens, and known wallet addresses in `~/.h402/config.json`.

## Contributing

```bash
npm run -w @h402/cli typecheck
npm run -w @h402/cli lint
npm run -w @h402/cli test
```

## License

MIT
