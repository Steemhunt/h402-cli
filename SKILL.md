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
and returns a free result or settles a payable challenge in Base USDC. No per-vendor API
keys or subscriptions; a funded wallet is needed only for a payable challenge.

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
h402 search "AI news"
h402 quote web/search --json '{"query":"agent APIs"}'
h402 call ai/news                    # direct 2xx; no wallet or payment
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

## The loop: find → (quote) → call

```bash
# 1. Find a route (returns JSON catalog matches)
h402 search "token holders"

# 2. (optional) Preview the price before paying
h402 quote crypto/token-holders --json '{"tokenAddress":"0x37f0c2915CeCC7e977183B8543Fc0864d03E064C","chain":"base"}'

# 3. Call it — pays automatically on the 402 challenge, returns the JSON result
h402 call crypto/token-holders --name agent \
  --json '{"tokenAddress":"0x37f0c2915CeCC7e977183B8543Fc0864d03E064C","chain":"base"}'
```

- A route id is `category/action` (e.g. `web/search`, `maps/place-details`, `finance/stock-quote`).
- `--json '{...}'` is the request body; use `--query '{...}'` for GET query params instead.
- Auto routing capability-routes provider-native input to an enabled candidate whose strict schema accepts it. `web/search` accepts common fields such as `query` and `limit` on the default `auto` route, and capable candidates can also accept native fields such as `freshness` without a pin. Use `--provider` only for determinism, deliberate provider selection, or provider-bound follow-ups.
- Every command prints **JSON to stdout** (including `wallet fund` and `wallet balance`); failures print to stderr and exit non-zero.
- A successful `call` returns `{ "data": <provider result>, "meta"?: <contract metadata>, "h402": <routing metadata> }` — read the provider output from `data`, preserve `meta` when present, and inspect `h402` for `routeId`, `provider`, `selectedCandidateId`, `routing`, and `paidBy`. `ledgerEntryId` is present for credit or x402-paid calls; `paymentTransaction` and CLI-added `signedAmount` are x402-payment-only fields; free calls omit all three. Optional `followUp` describes async work. A failure exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr — read `error.message` for the reason, `error.detail` for the backend's JSON error when present.
- Async parent route IDs end in `-async`; a single-parent follow-up is `<parent-route>-status`, while shared multi-parent follow-ups may use a shared `*-status` name. If `h402.followUp` is present, the response is a job receipt, not the final result. Follow `h402.followUp.method`, `path`, `params.jobId`, `docsUrl`, and `instruction` (or the route's `*-status` capability) until the async job completes. The follow-up path is provider-bound, so preserve its provider segment in the CLI call. Match `followUp.method` — GET params go via `--query`, POST bodies via `--json`; the CLI rejects `--query` on a POST (`<followUp.params>` means its JSON-encoded object):

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
