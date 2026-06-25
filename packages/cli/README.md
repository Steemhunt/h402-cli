# @h402/cli

[![npm](https://img.shields.io/npm/v/%40h402%2Fcli?label=%40h402%2Fcli)](https://www.npmjs.com/package/@h402/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Local, non-custodial CLI for [h402](../../README.md) — the x402 router for agent capabilities. Browse the catalog, quote a task, and pay-per-call from a local wallet in Base USDC over x402. **Private keys never leave your machine.**

Building an AI agent? See [`SKILL.md`](../../SKILL.md) for an agent-ready walkthrough.

## Install

```bash
npm install -g @h402/cli
```

> **Requires the OWS wallet binary.** The CLI signs through the [Open Wallet Standard](https://github.com/open-wallet-standard) CLI. Install it and ensure `ows` is on your `PATH` (or set `H402_OWS_BIN`).

## Quickstart

```bash
h402 wallet create --name agent --no-passphrase      # local wallet
h402 wallet fund --name agent                        # or send Base USDC to the address
h402 call web/search --name agent --no-passphrase --json '{"query":"agent APIs","limit":5}'
```

Calls hit the production backend (`https://h402.hunt.town`) by default — override with `--api-url` or `H402_API_URL` (e.g. `http://localhost:3000` for local dev).

## Commands

| Command | Description |
| --- | --- |
| `h402 wallet create --name <n>` | Create a local OWS wallet (prints its address) |
| `h402 wallet address --name <n>` | Print the wallet address |
| `h402 wallet balance --name <n>` | Show the wallet's Base USDC balance |
| `h402 wallet fund --name <n>` | Open the OWS deposit flow to fund the wallet |
| `h402 auth --name <n>` | Sign in to a backend with a wallet signature (enables bonus credits) |
| `h402 credits` | Show the bonus-credit balance for the signed-in session |
| `h402 search <query>` | Search the catalog (JSON results) |
| `h402 quote <category/action>` | Preview the x402 `PAYMENT-REQUIRED` envelope without paying |
| `h402 call <category/action>` | Execute a paid proxy call (signs + retries on 402) |

Run `h402 --help`, `h402 <command> --help`, or `h402 wallet <subcommand> --help` for usage and flags, and `h402 --version` for the version. Unknown flags and unknown commands fail with a non-zero exit.

## Flags

| Flag | Applies to | Description |
| --- | --- | --- |
| `--name <wallet>` | all | Wallet to use (default `h402`) |
| `--wallet 0x...` | all | Sign with the local wallet that owns this address (must exist locally; must agree with `--name` if both are passed) |
| `--api-url <url>` | all | Backend base URL override (or `H402_API_URL`; default `https://h402.hunt.town`) |
| `--json '{...}'` | quote, call | Request body (sets method to POST) |
| `--query '{...}'` | quote, call | URL query params (GET) |
| `--provider <name>` | quote, call | Pin a provider; default is `auto` (h402 picks the best) |
| `--method GET\|POST` | quote, call | Override the method (inferred from `--json` otherwise) |
| `--passphrase <s>` | create, auth, call | Signing passphrase (or `H402_WALLET_PASSPHRASE`) |
| `--no-passphrase` | create, auth, call | Sign without a passphrase (disposable wallets only) |
| `--no-credit` | call | Ignore bonus credits and pay x402 only |
| `--idempotency-key <uuid>` | call | Stable key for safe retries (default: random) |
| `--limit <n>` | search | Max results (default `20`) |

Route ids are `category/action`, e.g. `web/search`, `maps/place-details`, `finance/stock-quote`.

## How a paid call works

```
h402 call web/search --json '{"query":"..."}'
   │
   ├─ POST /routes/auto/web/search           → 402 PAYMENT-REQUIRED (x402 challenge)
   ├─ sign Base USDC EIP-3009 transferWithAuthorization locally (via OWS)
   └─ retry with PAYMENT-SIGNATURE + same idempotency-key → 200 + JSON result
```

You're charged the exact per-call price (most routes are $0.001–$0.05). Because the retry
reuses the idempotency key, a resent paid request never double-charges. Run `h402 quote`
first to see the price without paying. If you've run `h402 auth`, bonus credits are drawn
before USDC unless you pass `--no-credit`.

## Agents & automation

Everything is non-interactive and JSON-first:

```bash
export H402_WALLET_PASSPHRASE=...                 # or use --no-passphrase

h402 search "token holders"                        # JSON to stdout
h402 call crypto/token-holders --name agent \
  --json '{"tokenAddress":"0x...","chain":"base"}' # JSON result, non-zero exit on failure
```

## Environment

| Variable | Purpose |
| --- | --- |
| `H402_API_URL` | Backend base URL override (or `--api-url`; default `https://h402.hunt.town`) |
| `H402_OWS_BIN` | Path to the OWS binary (default `ows`) |
| `H402_WALLET_PASSPHRASE` | Non-interactive passphrase for signing |

Passphrases are never stored. Use `--no-passphrase` only for disposable test wallets. The CLI persists only the backend URL, session tokens, and known wallet addresses in `~/.h402/config.json`.

## Contributing

```bash
npm run -w @h402/cli typecheck
npm run -w @h402/cli lint
npm run -w @h402/cli test
```

## License

MIT
