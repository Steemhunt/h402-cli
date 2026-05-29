# @h402/cli

[![npm](https://img.shields.io/npm/v/%40h402%2Fcli?label=%40h402%2Fcli)](https://www.npmjs.com/package/@h402/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Local, non-custodial CLI for [h402](../../README.md) — the capability marketplace for AI agents. Browse the catalog, get a quote, and pay-per-call from a local wallet. Private keys never leave your machine.

## Install

```bash
npm install -g @h402/cli
```

> **Requires the OWS wallet binary.** The CLI signs through the [Open Wallet Standard](https://github.com/open-wallet-standard) CLI. Install it and ensure `ows` is on your `PATH` (or set `H402_OWS_BIN`).

## Commands

| Command | Description |
| --- | --- |
| `h402 wallet create --name <n>` | Create a local OWS wallet |
| `h402 wallet address --name <n>` | Print the wallet address |
| `h402 wallet balance --name <n>` | Show Base USDC balance |
| `h402 wallet fund --name <n>` | Deposit funds |
| `h402 auth --name <n>` | Sign in to a backend (wallet signature) |
| `h402 credits` | Show weekly Building credit balance |
| `h402 delegation list\|save\|delete` | Manage Building credit delegation |
| `h402 search <query>` | Search the catalog |
| `h402 quote <category/action>` | Preview the x402 `PAYMENT-REQUIRED` envelope |
| `h402 call <category/action>` | Execute a paid proxy call |

```bash
h402 wallet create --name agent
h402 auth --name agent
h402 call web/search --json '{"query":"agent APIs","numResults":5}'
```

Proxy calls first try HUNT weekly credit when a session exists. On an x402 `PAYMENT-REQUIRED`, the CLI signs a Base USDC EIP-3009 `PAYMENT-SIGNATURE` locally and retries the same request.

## Environment

| Variable | Purpose |
| --- | --- |
| `H402_API_URL` | Backend base URL (or `--api-url`) |
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
