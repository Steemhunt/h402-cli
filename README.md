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
h402 wallet fund --name agent --amount 5
h402 call web/search --provider stableenrich-exa --name agent --json '{"query":"agent payments"}'
```

Browsing, quoting, and free-route calls do not require a local wallet. Wallet creation creates a local signing wallet only; `h402 auth` creates the optional bonus-credit session. A funded local wallet is required only if the first response is a payable `402`.

The CLI targets the production backend (`https://h402.hunt.town`) by default; set `H402_API_URL` or `--api-url` only when pointing at another backend such as local dev.

`wallet fund` returns a `fundingUrl` for a human to open and send native USDC on Base, with a suggested amount of 5 USDC by default. Noninteractive runs return immediately; hand the link to the human, then run `h402 wallet fund --name agent --wait --timeout 300` to watch for a new balance increase. Interactive terminals wait automatically. Waiting ends after 300 seconds by default (configurable from 1 to 3600 seconds), and success reports the actual increase, even if the human sends a different amount. If the transfer has already arrived before waiting starts, use `h402 wallet balance` to check it. The CLI never opens a browser or transfers funds for this command.

Set `"defaultWallet": "agent"` in the existing `~/.h402/config.json` to select a default local signing wallet. Explicit `--name` or `--wallet` takes precedence; without this setting, the default remains `h402`. The CLI fails if the selected wallet is missing rather than using a different wallet.

OWS is the live source for wallet names and addresses; the CLI does not cache wallet addresses in config. `--name` resolves the current OWS wallet by name; `--wallet` selects the OWS wallet that currently owns that address. If both are passed, they must agree.

The CLI signs locally through [Open Wallet Standard](https://github.com/open-wallet-standard) core, whose wallet and signing methods lazy-load a platform package.

All wallet commands, `h402 auth`, and signing a payable call require OWS native bindings, available only on macOS and glibc-based Linux, on x64 or arm64. Windows, musl/Alpine, and other OS/architecture combinations can still run `--help`, `search`, `show`, `quote`, and free-route `call`, but cannot run wallet commands, `h402 auth`, or sign a payable call until OWS ships a matching native binding. Before creating or funding a wallet, run `h402 wallet list` as a read-only native-binding preflight.

## How it works

Each call uses one concrete provider. Without `--provider`, the CLI resolves the route's current `defaultProvider` from full catalog detail before sending the call. Successes include `h402.cliProviderSelection`, and post-resolution failures include the same metadata at `error.detail.h402.cliProviderSelection`. Its `pinnedCommand` is a shell-escaped fresh-call recipe that preserves non-secret request, backend, wallet, and payment-safety flags and omits passphrases and the previous idempotency key. Passing `--provider` skips default resolution and calls that pinned path directly. A `410` response is never retried automatically: read `error.detail.error.candidates`, inspect the replacement with `h402 show`, then start a new explicit call. An unknown route preserves `error.detail.error.recovery.command`, which points back to `h402 search`.

After provider resolution, the CLI sends the request before resolving a wallet. An initial 2xx is returned directly — `h402.paidBy` says whether it was `free` (no charge) or covered by bonus `credit` from an authenticated session. Only when the first response is an x402 `402 PAYMENT-REQUIRED` does the CLI resolve a funded local wallet, sign a Base USDC EIP-3009 authorization locally, and retry the same pinned provider path. Pass `--max-usd <amount>` (or store a string `maxUsd`, such as `"0.05"`, in `~/.h402/config.json`) to refuse signing a challenge above that USDC cap. Keys never leave your machine.

A successful `call` prints `{ "data": <provider-native body>, "meta"?: <reserved envelope metadata>, "h402": <execution metadata> }`: `data` stays provider-native, optional `meta` remains reserved envelope metadata rather than normalized provider output, and `h402` carries the provider-pinned execution receipt plus CLI-added `cliProviderSelection`. `ledgerEntryId` is present for credit or x402-paid calls; `paymentTransaction` and CLI-added `signedAmount` are x402-payment-only fields; free calls omit all three. Optional `h402.followUp` instructions describe async work. On failure the CLI exits non-zero and writes `{ "error": { "message", "detail"? } }` to stderr — `message` is human-readable and `detail` preserves the backend recovery body unchanged.

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

Node 22.19+. ESM throughout.

## Releasing

**A release is complete only when both the npm package and its matching GitHub Release are published and verified.** npm publication does not create a GitHub Release automatically.

Version packages independently. Publish a changed `@h402/core` before a CLI version that needs it; do not republish an unchanged core version. `@h402/cli` depends on core from the npm registry, so its required core version must already be available for a clean install to succeed.

Bump the package version and lockfile, commit and push the release preparation to `main`, and publish from that clean commit after CI passes. Prepare concise English release notes covering changes since the previous published version and any compatibility changes.

Before publishing, verify and smoke-test the packed artifacts:

```bash
npm run verify:pack   # each tarball ships its compiled dist
npm run smoke:pack    # pack core+cli, install both into a clean project, run `h402 --help`
```

Each package's `prepack` builds `dist` automatically on `npm pack` / `npm publish`; `verify:pack` asserts the tarball contents so a clean checkout can never publish a package without its JS/types. `smoke:pack` goes further — it installs the packed core + cli into a throwaway prefix and runs `h402 --help`, catching install/entrypoint breakage (an unresolvable `@h402/core`, a broken bin) that an in-repo build would hide. (It runs only `--help`, so it does not cover OWS-binary resolution.) Both run in CI.

Publish the prepared CLI package using the publisher's npm authentication:

```bash
npm publish --workspace @h402/cli --access public
```

After npm confirms publication, read the exact version's published source commit. If a human runs the npm command, resume these steps after they confirm success; handing off the publish command alone does not complete the release.

```bash
release_version=$(node -p "require('./packages/cli/package.json').version")
release_commit=$(npm view "@h402/cli@$release_version" gitHead)
git show "$release_commit:packages/cli/package.json"
```

Require a full, resolvable `gitHead` and confirm that the committed manifest has the expected package name and version. Stop if the npm version is absent or the source cannot be verified; never substitute the current `main` commit. Check any existing remote tag or Release before creating one: its tag must resolve to the same published commit. Never move an existing release tag.

Save the reviewed English notes to `/tmp/h402-cli-release.md`, then create the matching GitHub Release:

```bash
release_latest=$(npm view @h402/cli dist-tags.latest)
test "$release_version" = "$release_latest" &&
test -n "$release_commit" &&
gh release create "cli-v$release_version" \
  --repo Steemhunt/h402-cli \
  --target "$release_commit" \
  --title "@h402/cli v$release_version" \
  --notes-file /tmp/h402-cli-release.md \
  --latest
```

Use `cli-v<version>` for CLI tags and `core-v<version>` for core tags. For core releases, use its workspace, manifest, npm package, notes file, and tag prefix, and pass `--latest=false`. Historical CLI releases also use `--latest=false`; only the CLI version matching npm's `latest` dist-tag should be marked Latest. Historical notes must state the original npm publication date, since the GitHub Release is being created later.

Verify the published Release's title, notes, tag commit, and Latest status. If npm succeeded but GitHub failed, retry only the GitHub step after inspecting its current state. Do not bump or republish the npm package to retry Release creation.

## License

MIT
