# @h402/cli

[![npm](https://img.shields.io/npm/v/%40h402%2Fcli?label=%40h402%2Fcli)](https://www.npmjs.com/package/@h402/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Local, non-custodial CLI for [h402](../../README.md) — the x402 router for agent capabilities. Browse and quote without a wallet, call free routes directly, and pay from a local wallet only when challenged over x402. **Private keys never leave your machine.**

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
h402 search "AI news"                                # wallet-free catalog browsing
h402 quote web/search --json '{"query":"agent APIs"}' # wallet-free quote
h402 call ai/news                                     # free route; no wallet required

# Only for routes that answer with a payable 402:
h402 wallet list                                     # read-only native-binding preflight; [] is OK
h402 wallet create --name agent                      # local signing wallet
h402 wallet fund --name agent                        # Base USDC address + instructions
h402 call web/search --name agent --json '{"query":"agent APIs"}'
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
| `h402 search <query>` | Search the catalog (JSON results) |
| `h402 quote <category/action>` | Preview the x402 `PAYMENT-REQUIRED` envelope without paying |
| `h402 call <category/action>` | Execute a route and pay if challenged; free routes need no wallet |

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

## How a call works

```
h402 call web/search --json '{"query":"..."}'
   │
   ├─ initial request (before wallet resolution)
   ├─ 2xx → returned directly; h402.paidBy says free or credit
   └─ payable 402 → resolve wallet, sign Base USDC locally, then retry the same request
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

`--idempotency-key` is double-charge protection, not result replay. If a paid response is
lost, reusing the same key prevents a duplicate server-side operation, but the server may
return `idempotency_key_already_used`/`idempotency_key_in_progress` instead of replaying
the previous result. Do not switch to a new key unless you intentionally accept buying the
call again.

## Agents & automation

Every command prints JSON to stdout — `search`, `quote`, `call`, `auth`, `credits`, and `wallet create`/`list`/`restore`/`address`/`balance`/`fund`.

A successful `call` is wrapped as `{ "data": <provider result>, "meta"?: <contract metadata>, "h402": <routing metadata> }` — read the upstream provider payload from `data`, preserve `meta` when present, and inspect `h402` for `routeId`, `provider`, `selectedCandidateId`, `routing` (`auto`/`manual`), and `paidBy` (`x402-exact`/`credit`/`free`). `ledgerEntryId` is present for credit or x402-paid calls; `paymentTransaction` and CLI-added `signedAmount` are x402-payment-only fields; free calls omit all three. Optional `followUp` describes async work. A failed call exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr — `message` is always a readable diagnostic; `detail` holds the backend's JSON error when one was returned.

Async routes may return a job receipt instead of the final result. When `h402.followUp` is present, follow its `method`, `path`, `params.jobId`, `docsUrl`, and `instruction` (or the route's `*-status` capability) until the job completes. The follow-up path is provider-bound, so preserve the provider segment from that path when translating the instruction to CLI form. Match `followUp.method` — GET params go via `--query`, POST bodies via `--json`; the CLI rejects `--query` on a POST (`<followUp.params>` means its JSON-encoded object):

```bash
# followUp.method GET (most status polls):
h402 call <followUp.routeId> \
  --provider <provider-from-followUp.path> \
  --query '<followUp.params>'

# followUp.method POST (e.g. ai/music-status-async):
h402 call <followUp.routeId> \
  --provider <provider-from-followUp.path> \
  --json '<followUp.params>'
```

Auto routing capability-routes provider-native input to an enabled candidate whose strict schema accepts it. `web/search` accepts common fields such as `query` and `limit` on the default `auto` route, and capable candidates can also accept native fields such as `freshness` without a pin. Use `--provider` only for determinism, deliberate provider selection, or provider-bound follow-ups.

```bash
h402 search "token holders"                        # JSON to stdout
h402 call crypto/token-holders --name agent \
  --json '{"tokenAddress":"0x37f0c2915CeCC7e977183B8543Fc0864d03E064C","chain":"base"}' # JSON result, non-zero exit on failure
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
