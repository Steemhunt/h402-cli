# @h402/cli

[![npm](https://img.shields.io/npm/v/%40h402%2Fcli?label=%40h402%2Fcli)](https://www.npmjs.com/package/@h402/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Local, non-custodial CLI for [h402](../../README.md) — the x402 router for agent capabilities. Browse the catalog, quote a task, and pay-per-call from a local wallet in Base USDC over x402. **Private keys never leave your machine.**

Building an AI agent? See [`SKILL.md`](../../SKILL.md) for an agent-ready walkthrough.

## Install

```bash
npm install -g @h402/cli
```

> The [Open Wallet Standard](https://github.com/open-wallet-standard) core library ships with the CLI, so a global install is self-contained on supported platforms.
>
> OWS native bindings currently target macOS/Linux glibc on x64/arm64. Non-wallet commands (`--help`, `search`, `quote`) lazy-load OWS and still work without native bindings; wallet creation and payment signing require those JS native bindings.

## Quickstart

```bash
h402 wallet create --name agent                      # local wallet (passphrase-less by default)
h402 wallet fund --name agent                        # prints the Base USDC address + instructions
h402 wallet list                                     # inspect local OWS wallets
h402 wallet restore                                  # re-adopt existing OWS wallets into config
h402 call web/search --name agent --json '{"query":"agent APIs"}'
```

Calls hit the production backend (`https://h402.hunt.town`) by default — override with `--api-url` or `H402_API_URL` (e.g. `http://localhost:3000` for local dev).

## Commands

| Command | Description |
| --- | --- |
| `h402 wallet create --name <n>` | Create a local OWS wallet (prints its address) |
| `h402 wallet list` | List OWS wallets |
| `h402 wallet restore` | Re-adopt OWS wallets into `~/.h402/config.json` |
| `h402 wallet address --name <n>` | Print the wallet address |
| `h402 wallet balance --name <n>` | Show the wallet's structured Base USDC balance |
| `h402 wallet fund --name <n>` | Print the Base USDC deposit address and funding instructions |
| `h402 auth --name <n>` | Sign in to a backend with a wallet signature (enables bonus credits) |
| `h402 credits` | Show the bonus-credit balance for the signed-in session |
| `h402 search <query>` | Search the catalog (JSON results) |
| `h402 quote <category/action>` | Preview the x402 `PAYMENT-REQUIRED` envelope without paying |
| `h402 call <category/action>` | Execute a paid proxy call (signs + retries on 402) |

Run `h402 --help`, `h402 <command> --help`, or `h402 wallet <subcommand> --help` for usage and flags, and `h402 --version` for the version. Unknown flags and unknown commands fail with a non-zero exit.

## Flags

| Flag | Applies to | Description |
| --- | --- | --- |
| `--name <wallet>` | wallet create/address/balance/fund; auth; call | Wallet to use (default `h402`) |
| `--wallet 0x...` | wallet address/balance/fund; auth; call | Sign with the local wallet that owns this address (must exist locally; must agree with `--name` if both are passed) |
| `--api-url <url>` | auth, credits, search, quote, call | Backend base URL override (or `H402_API_URL`; default `https://h402.hunt.town`) |
| `--json '{...}'` | quote, call | Request body (sets method to POST) |
| `--query '{...}'` | quote, call | URL query params (GET); values must be strings/numbers/booleans |
| `--provider <name>` | quote, call | Pin a provider; default is `auto` (h402 picks the best) |
| `--method GET\|POST` | quote, call | Override the method (inferred from `--json` otherwise) |
| `--passphrase [<s>]` | wallet create, auth, call | Passphrase for a passphrase-protected wallet; omit the value to be prompted (or `H402_WALLET_PASSPHRASE`) |
| `--no-passphrase` | wallet create, auth, call | Force passphrase-less signing even if `H402_WALLET_PASSPHRASE` is set (the default needs no flag) |
| `--no-credit` | call | Ignore bonus credits and pay x402 only |
| `--max-usd <usd>` | call | Optional client-side cap; refuse to sign if the quoted Base USDC amount exceeds it |
| `--idempotency-key <uuid>` | call | Stable key for safe retries (default: random) |
| `--limit <n>` | search | Max results (default `20`) |

Route ids are `category/action`, e.g. `web/search`, `maps/place-details`, `finance/stock-quote`. `--query` takes one scalar value per key (string, number, or boolean); pass arrays, nested objects, or request bodies with `--json` instead.

## How a paid call works

```
h402 call web/search --json '{"query":"..."}'
   │
   ├─ POST /routes/auto/web/search           → 402 PAYMENT-REQUIRED (x402 challenge)
   ├─ sign Base USDC EIP-3009 transferWithAuthorization locally (via OWS)
   └─ retry with PAYMENT-SIGNATURE + same idempotency-key → 200 + JSON result
```

You're charged the exact per-call price (most routes are $0.001–$0.05). Run `h402 quote`
first to see the price without paying. Pass `--max-usd <amount>` on `call` (or store a
string `maxUsd`, such as `"0.05"`, in `~/.h402/config.json`) to refuse signing a
challenge above that USDC cap. Paid call output includes `h402.signedAmount` so agents
can record the amount they signed. The CLI uses the first 402 response's `Date` header
when building the EIP-3009 validity window, reducing client clock-skew failures on paid
calls. If you've run `h402 auth`, bonus credits are drawn before USDC unless you pass
`--no-credit`.

`--idempotency-key` is double-charge protection, not result replay. If a paid response is
lost, reusing the same key prevents a duplicate server-side operation, but the server may
return `idempotency_key_already_used`/`idempotency_key_in_progress` instead of replaying
the previous result. Do not switch to a new key unless you intentionally accept buying the
call again.

## Agents & automation

Every command prints JSON to stdout — `search`, `quote`, `call`, `auth`, `credits`, and `wallet create`/`list`/`restore`/`address`/`balance`/`fund`.

A successful `call` is wrapped as `{ "data": <provider result>, "meta"?: <contract metadata>, "h402": <routing metadata> }` — read the upstream provider payload from `data`, preserve `meta` when present, and inspect `h402` for `routeId`, `provider`, `selectedCandidateId`, `routing` (`auto`/`manual`), `paidBy` (`x402-exact`/`credit`/`free`), `ledgerEntryId`, optional `paymentTransaction`, optional `followUp`, and optional `signedAmount` for paid x402 calls. A failed call exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr — `message` is always a readable diagnostic; `detail` holds the backend's JSON error when one was returned.

Async routes may return a job receipt instead of the final result. When `h402.followUp` is present, follow its `method`, `path`, `params.jobId`, `docsUrl`, and `instruction` (or the route's `*-status` capability) until the job completes.

`web/search` accepts common fields such as `query` and `limit` on the default `auto` route. Provider-specific fields on other routes/candidates still require pinning the owning provider with `--provider`; otherwise auto-routing may reject the request.

```bash
h402 search "token holders"                        # JSON to stdout
h402 call crypto/token-holders --name agent \
  --json '{"tokenAddress":"0x...","chain":"base"}' # JSON result, non-zero exit on failure
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
