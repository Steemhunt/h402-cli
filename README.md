# h402 CLI

Local non-custodial CLI for the h402 curated MVP.

## Development

```bash
npm install
npm run build
```

## Commands

```bash
h402 wallet create --name h402
h402 wallet address --name h402
h402 wallet balance --name h402
h402 wallet fund --name h402
h402 auth --name h402
h402 credits
h402 search "web search"
h402 quote web/search/exa --json '{"query":"agent APIs","numResults":5}'
h402 call web/search/exa --json '{"query":"agent APIs","numResults":5}'
```

The CLI keeps private keys in OWS. It stores only backend URL, session tokens, and
known wallet addresses in `~/.h402/config.json`.

`h402 quote` previews the standard x402 `PAYMENT-REQUIRED` envelope for a route.
Proxy calls first try HUNT daily credit when an auth session is available. If the
backend returns x402 `PAYMENT-REQUIRED`, the CLI signs a Base USDC EIP-3009
`PAYMENT-SIGNATURE` locally through OWS and retries the same request.

Passphrases are never stored by h402. Interactive commands prompt with hidden
input when no passphrase is provided. For non-interactive use, set
`H402_WALLET_PASSPHRASE`.

Set `H402_API_URL` or pass `--api-url` to point at another backend.
