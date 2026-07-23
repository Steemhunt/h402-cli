---
name: h402
description: >-
  Call any agent capability — web search, crypto & market data, maps, social,
  finance, security checks, OCR, weather, and more — through h402's capability
  store and concrete provider paths, paying per call in Base USDC over x402 with
  the open-source h402 CLI. Use when
  an agent needs live external data or a paid API without managing per-provider
  API keys or subscriptions.
---

# h402 — pay-per-call capabilities for AI agents

h402 is the **x402 capability store for agents**. Discover a task, inspect its enabled
providers and provider-native contracts, then call one concrete provider path. h402
returns a free result or settles a payable challenge in Base USDC without per-vendor
API keys or subscriptions. A funded wallet is needed only for a payable challenge.

## When to use this

Reach for h402 whenever you need a live external capability you don't already have a
tool for — web search & search-grounded answers, crypto prices & on-chain data, maps
& places, social profiles, stock/finance data, token & wallet security checks, OCR /
PDF parsing, weather, and more. Browse everything at https://h402.hunt.town/catalog.

## One-time setup

Install the `h402` CLI first. Browsing, quoting, and free-route calls do not require a local wallet. The CLI uses `@open-wallet-standard/core`, whose wallet and signing methods lazy-load a platform package.

OWS wallet creation and signing use native bindings available only on macOS and glibc-based Linux, on x64 or arm64. Windows, musl/Alpine, and other OS/architecture combinations can still run `--help`, `search`, `quote`, and free-route `call`, but cannot create, list, restore, or auto-adopt wallets, run `h402 auth`, or sign a payable call until OWS ships a matching native binding. `wallet address`, `wallet balance`, and `wallet fund` keep working for wallets already mapped in `~/.h402/config.json` — but USDC funded from an unsupported host can only be spent by signing on a supported platform. Before creating or funding a wallet, run `h402 wallet list` as a read-only native-binding preflight.

```bash
npm install -g @h402/cli            # install the CLI
```

Calls go to the production backend (`https://h402.hunt.town`) by default; set `H402_API_URL` or `--api-url` to point at another backend.

```bash
h402 search "web search"                         # compact summaries
h402 show web/search                             # full route + all provider contracts
h402 show web/search --provider stableenrich-exa # one full provider-native contract
h402 quote web/search --provider stableenrich-exa --json '{"query":"agent APIs"}'
h402 call ai/news                                # direct 2xx; omitted provider resolves defaultProvider
```

Wallet creation creates a local signing wallet only; `h402 auth` creates the optional bonus-credit session. A funded local wallet is required only if the first response is a payable `402`.

For payable routes, create a wallet — passphrase-less by default, the right setup for an agent budget wallet
(opt into one with `--passphrase <s>` only if you want it; then every signing command needs it):

```bash
h402 wallet list                     # read-only native-binding preflight; [] is OK
h402 wallet create --name agent
# -> {"wallet":{"name":"agent","address":"0x..."}}
```

Fund it with **Base USDC**: send USDC (on Base) to that address from an exchange,
bridge, or another wallet. `h402 wallet fund --name agent` prints the address and
funding instructions; it does not depend on the OWS/MoonPay deposit flow. Then check it:

```bash
h402 wallet balance --name agent
```

A few dollars of USDC covers hundreds of calls — most routes cost **$0.001–$0.05** each.

## The loop: find → inspect → (quote) → call

```bash
# 1. Find a route (compact JSON summaries)
h402 search "token holders"

# 2. Inspect full provider-native contracts and samples
h402 show crypto/token-holders
h402 show crypto/token-holders --provider nansen

# 3. (optional) Preview the price for that concrete provider
h402 quote crypto/token-holders --provider nansen \
  --json '{"chain":"base","token_address":"0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913"}'

# 4. Call it — pays on a 402 challenge and keeps the provider pinned
h402 call crypto/token-holders --provider nansen --name agent \
  --json '{"chain":"base","token_address":"0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913"}'
```

- A route id is `category/action` (e.g. `web/search`, `maps/place-details`, `finance/stock-quote`).
- `--json '{...}'` is the request body; use `--query '{...}'` for GET query params instead.
- Each call uses one concrete provider. Without `--provider`, the CLI resolves the route's current `defaultProvider` from full catalog detail before execution. Successes record the choice in `h402.cliProviderSelection`; post-resolution failures record it at `error.detail.h402.cliProviderSelection`. The shell-escaped `pinnedCommand` is a fresh-call recipe that keeps non-secret request, backend, wallet, and payment-safety flags but omits passphrases and the previous idempotency key. Prefer explicit `--provider` after inspection for reproducibility. A `410` response is never retried automatically; inspect `error.detail.error.candidates` and start a new explicit call only after choosing one. For an unknown route, follow the preserved `error.detail.error.recovery.command` search guidance.
- Every command prints **JSON to stdout** (including `wallet fund` and `wallet balance`); failures print to stderr and exit non-zero.
- A successful `call` returns `{ "data": <provider-native body>, "meta"?: <reserved envelope metadata>, "h402": <execution metadata> }` — `data` remains provider-native, optional `meta` is reserved envelope metadata rather than normalized provider output, and `h402` carries the execution receipt plus `cliProviderSelection`. `ledgerEntryId` is present for credit or x402-paid calls; `paymentTransaction` and CLI-added `signedAmount` are x402-payment-only fields; free calls omit all three. Optional `h402.followUp` describes async work. A failure exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr; `detail` preserves the backend recovery body unchanged.
- Async parent route IDs end in `-async`; a single-parent follow-up is `<parent-route>-status`, while shared multi-parent follow-ups may use a shared `*-status` name. If `h402.followUp` is present, the response is a job receipt, not the final result. Pass its provider-native `params` object according to `method` and preserve the provider from `path`. Match `followUp.method` — GET params go via `--query`, POST bodies via `--json`; the CLI rejects `--query` on a POST (`<followUp.params>` means its JSON-encoded object):

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

## How payment works (per call, non-custodial)

The CLI sends the first request before resolving a wallet. An initial 2xx is returned directly — `h402.paidBy` says whether it was `free` (no charge) or covered by bonus `credit` from an authenticated session. Only a payable `402` makes the CLI resolve a wallet, sign a Base USDC EIP-3009
`transferWithAuthorization` **locally** (your key never leaves the machine), attach it as
a `PAYMENT-SIGNATURE` header, and retry the same request. Pass `--max-usd <amount>`
(or store a string `maxUsd`, such as `"0.05"`, in `~/.h402/config.json`) to refuse
signing a challenge above that USDC cap. Paid call output includes `h402.signedAmount`
as a receipt of the amount signed. The CLI uses the first 402 response's `Date` header
when building the EIP-3009 validity window, reducing client clock-skew failures on paid
calls. `--idempotency-key` is double-charge protection, not result replay. If the server
reports `payment_settlement_pending`, the running CLI resends the exact
`PAYMENT-SIGNATURE`, key, method, path, provider, and body for bounded reconciliation
attempts. One CLI invocation creates at most one payment authorization: server-issued
replacement challenges are refused, and a separate explicit call is required to create
a new payment. The CLI does not persist payment signatures, so after the process exits it
cannot reconstruct the original signed request. Pending, reconciled, network, and gateway
errors after a signed send warn that settlement may still have occurred; only a matching
`payment_settlement_failed` response with `paid: false` and `safeToStartNewCall: true`
confirms that the original authorization was not paid.

## Running non-interactively (agents)

- Defaults to the production backend (`https://h402.hunt.town`); set `H402_API_URL` or `--api-url` only to override.
- Wallets are passphrase-less by default, so signing needs no flags and never prompts. Only if a wallet was created with an opt-in passphrase: `export H402_WALLET_PASSPHRASE=...` (the CLI says so when it hits such a wallet).
- Read stdout as JSON; check the process exit code (non-zero = failure, message on stderr).
- Record an explicit `--idempotency-key <uuid>` before a money-sensitive `call`. If the process exits after a lost response, keep that key for server-side duplicate protection, but expect settlement/conflict guidance rather than result or signature replay. Do **not** start a new call unless you intentionally accept a new payment, except when the server returns a matching `payment_settlement_failed` response with `paid: false` and `safeToStartNewCall: true` for the original authorization.

## Notes

- All payments are Base USDC over x402; the CLI is open-source and non-custodial.
- If you run `h402 auth`, bonus credits are drawn before USDC; pass `--no-credit` to force USDC.
- For custom (non-CLI) integration, import [`@h402/core`](./packages/core) and plug in your own signer. Its `selectExactRequirement` helper is scoped to h402 canonical Base USDC challenges; non-h402 x402 servers with short network names or multi-amount menus should use the primitives with a custom selector.
