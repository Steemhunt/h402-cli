---
name: h402
description: >-
  Call any agent capability — web search, crypto & market data, maps, social,
  finance, security checks, OCR, weather, and more — through one endpoint and
  pay per call in Base USDC over x402, using the open-source h402 CLI. Use when
  an agent needs live external data or a paid API without managing per-provider
  API keys or subscriptions.
---

# h402 — pay-per-call capabilities for AI agents

h402 is the **x402 router for agent capabilities**: one canonical endpoint per task.
You call the *task* (e.g. `web/search`), and h402 routes the call to the best provider
and settles per call in Base USDC. No per-vendor API keys, no subscriptions — just a
funded wallet and one CLI.

## When to use this

Reach for h402 whenever you need a live external capability you don't already have a
tool for — web search & search-grounded answers, crypto prices & on-chain data, maps
& places, social profiles, stock/finance data, token & wallet security checks, OCR /
PDF parsing, weather, and more. Browse everything at https://h402.hunt.town/catalog.

## One-time setup

You need the `h402` CLI and a Base USDC–funded wallet. The CLI signs locally and
bundles the `ows` wallet binary, so a global install is self-contained.

```bash
npm install -g @h402/cli            # the CLI (bundles the OWS wallet binary)
```

Calls go to the production backend (`https://h402.hunt.town`) by default; set `H402_API_URL` or `--api-url` to point at another backend.

Create a wallet — a disposable, no-passphrase wallet is fine as an agent budget wallet:

```bash
h402 wallet create --name agent --no-passphrase
# -> {"wallet":{"name":"agent","address":"0x..."}}
```

Fund it with **Base USDC**: send USDC (on Base) to that address from an exchange,
bridge, or another wallet — or run `h402 wallet fund --name agent`. Then check it:

```bash
h402 wallet balance --name agent
```

A few dollars of USDC covers hundreds of calls — most routes cost **$0.001–$0.05** each.

## The loop: find → (quote) → call

```bash
# 1. Find a route (returns JSON catalog matches)
h402 search "token holders"

# 2. (optional) Preview the price before paying
h402 quote crypto/token-holders --json '{"tokenAddress":"0x...","chain":"base"}'

# 3. Call it — pays automatically on the 402 challenge, returns the JSON result
h402 call crypto/token-holders --name agent --no-passphrase \
  --json '{"tokenAddress":"0x...","chain":"base"}'
```

- A route id is `category/action` (e.g. `web/search`, `maps/place-details`, `finance/stock-quote`).
- `--json '{...}'` is the request body; use `--query '{...}'` for GET query params instead.
- h402 auto-routes to the best provider. Pin one with `--provider <name>` for determinism.
- Every command prints **JSON to stdout**; failures print to stderr and exit non-zero.

## How payment works (per call, non-custodial)

The first request returns `402` with an x402 `PAYMENT-REQUIRED` challenge. The CLI signs
a Base USDC EIP-3009 `transferWithAuthorization` **locally** (your key never leaves the
machine), attaches it as a `PAYMENT-SIGNATURE` header, and retries the same request. You
are charged the exact per-call price and get the result back. Reuse `--idempotency-key`
on a retry — h402 dedupes by it, so a resent paid request never double-charges.

## Running non-interactively (agents)

- Defaults to the production backend (`https://h402.hunt.town`); set `H402_API_URL` or `--api-url` only to override.
- `export H402_WALLET_PASSPHRASE=...` (or `--no-passphrase` for a disposable wallet) — no prompt.
- Read stdout as JSON; check the process exit code (non-zero = failure, message on stderr).
- Pass `--idempotency-key <uuid>` when you retry a `call`.

## Notes

- All payments are Base USDC over x402; the CLI is open-source and non-custodial.
- If you run `h402 auth`, bonus credits are drawn before USDC; pass `--no-credit` to force USDC.
- For custom (non-CLI) integration, import [`@h402/core`](./packages/core) and plug in your own signer.
