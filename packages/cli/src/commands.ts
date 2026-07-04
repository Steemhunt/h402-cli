import { randomUUID } from "node:crypto";
import { assertOk, requestJson } from "./api.js";
import { backendUrl, loadConfig, saveConfig, type CliConfig } from "./config.js";
import { createOwsWallet, runOwsCli, signOwsMessage } from "./ows.js";
import { promptPassphrase } from "./prompt.js";
import { buildProxyPath, flagBoolean, flagString, parseJsonFlag, parseQueryFlag, printJson, requireValue, resolveMethod, type ParsedArgs } from "./utils.js";
import { createPaymentSignatureHeader, paymentRequiredFromResponse, X402_HEADERS } from "./x402.js";

const DEFAULT_WALLET_NAME = "h402";

function walletName(args: ParsedArgs) {
  return flagString(args.flags, "name", DEFAULT_WALLET_NAME) as string;
}

// Explicit passphrase from flags/env. Wallets are passphrase-less by default
// (the onboarding default), so this is usually undefined and signing simply
// runs without one. --no-passphrase force-skips even an exported passphrase.
function explicitPassphrase(args: ParsedArgs) {
  if (flagBoolean(args.flags, "no-passphrase")) {
    return undefined;
  }
  return flagString(args.flags, "passphrase", process.env.H402_WALLET_PASSPHRASE);
}

// OWS reports any keystore/passphrase disagreement as an AEAD decryption
// failure: a protected wallet signed without (or with the wrong) passphrase,
// or a passphrase supplied for a wallet created without one.
const PASSPHRASE_MISMATCH = /decryption failed/i;

async function promptBarePassphrase(options = { confirm: false }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Bare --passphrase prompts interactively; pass --passphrase <s> or set H402_WALLET_PASSPHRASE in non-interactive use.");
  }
  return promptPassphrase(options);
}

// Sign with the explicit passphrase (usually none). Only a passphrase-protected
// keystore escalates: prompt once on an interactive terminal, otherwise fail
// with the H402_WALLET_PASSPHRASE hint — that env var is only ever needed for
// wallets that opted into a passphrase at create time.
export async function signWithWalletPassphrase<T>(
  args: ParsedArgs,
  walletName: string,
  sign: (passphrase?: string) => Promise<T>
): Promise<T> {
  // Bare --passphrase = "prompt me" (kept out of shell history/env).
  const explicit = args.flags.passphrase === true ? await promptBarePassphrase() : explicitPassphrase(args);
  try {
    return await sign(explicit);
  } catch (error) {
    if (!(error instanceof Error) || !PASSPHRASE_MISMATCH.test(error.message)) {
      throw error;
    }
    if (explicit !== undefined) {
      throw new Error(`Wallet "${walletName}" rejected the passphrase from --passphrase / H402_WALLET_PASSPHRASE.`);
    }
    if (flagBoolean(args.flags, "no-passphrase")) {
      throw new Error(`Wallet "${walletName}" is passphrase-protected, but --no-passphrase was passed.`);
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(`Wallet "${walletName}" is passphrase-protected. Set H402_WALLET_PASSPHRASE (or pass --passphrase <s>) for non-interactive use.`);
    }
    return sign(await promptPassphrase({ confirm: false }));
  }
}

// Passphrase for `wallet create`: none by default (agents sign with zero flags);
// opt in with `--passphrase <s>` / H402_WALLET_PASSPHRASE, or bare `--passphrase`
// to be prompted with confirmation.
export async function createPassphrase(args: ParsedArgs) {
  if (args.flags.passphrase === true) {
    return promptBarePassphrase({ confirm: true });
  }
  return explicitPassphrase(args);
}

// Resolve the wallet that will BOTH sign and own the request address, so the two
// can never silently diverge. The OWS signer is keyed by wallet *name*, so the
// address presented upstream must be that wallet's address — not an unrelated
// `--wallet` string. `--name` selects by name; `--wallet` selects the local
// wallet that owns that address; if both are given they must agree.
export async function resolveSigningWallet(args: ParsedArgs, config?: CliConfig): Promise<{ name: string; address: string }> {
  config ??= await loadConfig();
  const explicitAddress = flagString(args.flags, "wallet")?.toLowerCase();
  const explicitName = flagString(args.flags, "name");

  if (explicitName) {
    const address = config.wallets[explicitName]?.address?.toLowerCase();
    if (!address) {
      throw new Error(`No address known for wallet "${explicitName}". Run: h402 wallet create --name ${explicitName}`);
    }
    if (explicitAddress && explicitAddress !== address) {
      throw new Error(`--wallet ${explicitAddress} does not match wallet "${explicitName}" (${address}). Omit --wallet or pass the wallet that owns this address.`);
    }
    return { name: explicitName, address };
  }

  if (explicitAddress) {
    const owner = Object.entries(config.wallets).find(([, wallet]) => wallet.address?.toLowerCase() === explicitAddress);
    if (!owner) {
      throw new Error(`No local wallet owns address ${explicitAddress}. Create it (h402 wallet create) or select one with --name.`);
    }
    return { name: owner[0], address: explicitAddress };
  }

  const address = config.wallets[DEFAULT_WALLET_NAME]?.address?.toLowerCase();
  if (!address) {
    throw new Error(`No address known for wallet "${DEFAULT_WALLET_NAME}". Run: h402 wallet create --name ${DEFAULT_WALLET_NAME} (or pass --name/--wallet).`);
  }
  return { name: DEFAULT_WALLET_NAME, address };
}

export async function walletCommand(args: ParsedArgs) {
  const subcommand = requireValue(args.positional[1], "wallet subcommand is required");
  const name = walletName(args);
  const config = await loadConfig();

  if (subcommand === "create") {
    const wallet = await createOwsWallet(name, await createPassphrase(args));
    config.wallets[name] = { address: wallet.address };
    await saveConfig(config);
    printJson({ wallet: { name, address: wallet.address } });
    return;
  }

  if (subcommand === "address") {
    printJson({ wallet: await resolveSigningWallet(args, config) });
    return;
  }

  if (subcommand === "balance") {
    // OWS keys wallets by name; resolve --name/--wallet to the owning wallet so
    // `--wallet 0x...` selects the same wallet here as it does for signing.
    const { name: signingName, address } = await resolveSigningWallet(args, config);
    // OWS prints a human balance table; wrap it in a stable JSON envelope so the
    // agent-facing JSON-stdout contract holds (the raw text is preserved as-is —
    // parsing the human table into numbers would be fragile for a money tool).
    const raw = await runOwsCli(["fund", "balance", "--wallet", signingName, "--chain", "base"]);
    printJson({ wallet: { name: signingName, address }, chain: "base", balance: { raw } });
    return;
  }

  if (subcommand === "fund") {
    // `ows fund deposit` opens an interactive MoonPay deposit flow, so this is a
    // human/passthrough command (documented as such) — not part of the JSON contract.
    const { name: signingName } = await resolveSigningWallet(args, config);
    const output = await runOwsCli(["fund", "deposit", "--wallet", signingName, "--chain", "8453", "--token", "USDC"]);
    process.stdout.write(`${output}\n`);
    return;
  }

  throw new Error(`Unknown wallet subcommand: ${subcommand}`);
}

export async function authCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const { name, address } = await resolveSigningWallet(args, config);
  const challenge = assertOk(
    await requestJson<{ challenge: { message: string } }>(apiUrl, "/api/auth/challenge", {
      method: "POST",
      body: JSON.stringify({ address })
    })
  ).challenge;
  const signature = await signWithWalletPassphrase(args, name, (passphrase) => signOwsMessage(name, challenge.message, passphrase));
  const session = assertOk(
    await requestJson<{ session: { token: string; address: string; expiresAt: string } }>(apiUrl, "/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address, message: challenge.message, signature })
    })
  ).session;

  config.backendUrl = apiUrl;
  config.sessions[apiUrl] = session.token;
  await saveConfig(config);
  printJson({ session });
}

function searchLimit(flags: Record<string, string | boolean>) {
  const raw = flagString(flags, "limit", "20") as string;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`Flag --limit must be a positive integer (got "${raw}").`);
  }
  return raw;
}

function rejectQueryOnPost(method: "GET" | "POST", query: Record<string, unknown> | undefined) {
  if (method === "POST" && query && Object.keys(query).length > 0) {
    throw new Error("Flag --query cannot be combined with POST requests; use --query for GET parameters or --json for a POST body, not both.");
  }
}

export async function searchCommand(args: ParsedArgs) {
  // Validate the required query before any network work.
  const query = requireValue(args.positional.slice(1).join(" ").trim() || undefined, 'search query is required (e.g. h402 search "web search")');
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const params = new URLSearchParams({ q: query, limit: searchLimit(args.flags) });
  const result = assertOk(await requestJson(apiUrl, `/api/catalog/search?${params.toString()}`));
  printJson(result);
}

export async function creditsCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const token = config.sessions[apiUrl];
  if (!token) {
    throw new Error("No session token. Run h402 auth first.");
  }

  printJson(assertOk(await requestJson(apiUrl, "/api/me/credits", { token })));
}

export async function quoteCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const routeId = requireValue(args.positional[1], "route id is required");
  const body = parseJsonFlag(args.flags);
  const query = parseQueryFlag(args.flags);
  const provider = flagString(args.flags, "provider");
  const method = resolveMethod(args.flags, body !== undefined);
  rejectQueryOnPost(method, query);
  const result = await requestJson(apiUrl, buildProxyPath(routeId, query, provider), {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const paymentRequired = paymentRequiredFromResponse(result.headers, result.body);
  if (paymentRequired) {
    printJson({ paymentRequired });
    return;
  }
  // No challenge: a free route returns its result with a 2xx. Any non-2xx
  // (404/500/...) is a real error and must exit non-zero, not print as a result.
  printJson(assertOk(result));
}

export async function callCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const routeId = requireValue(args.positional[1], "route id is required");
  const body = parseJsonFlag(args.flags);
  const query = parseQueryFlag(args.flags);
  const provider = flagString(args.flags, "provider");
  const method = resolveMethod(args.flags, body !== undefined);
  rejectQueryOnPost(method, query);
  const idempotencyKey = flagString(args.flags, "idempotency-key", randomUUID()) as string;
  const token = config.sessions[apiUrl];
  const { name, address: walletAddress } = await resolveSigningWallet(args, config);
  const path = buildProxyPath(routeId, query, provider);
  const headers: Record<string, string> = {
    "idempotency-key": idempotencyKey
  };

  if (token && !flagBoolean(args.flags, "no-credit")) {
    headers.authorization = `Bearer ${token}`;
  }

  const first = await requestJson<unknown>(apiUrl, path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const paymentRequired = first.status === 402 ? paymentRequiredFromResponse(first.headers, first.body) : null;
  if (!paymentRequired) {
    // A 2xx means the route answered without payment (free, or covered by credit).
    // A non-2xx first response (incl. an unparseable 402) is a real error: assertOk
    // exits non-zero instead of printing the error body as a successful result.
    printJson(assertOk(first));
    return;
  }

  const paymentSignature = await signWithWalletPassphrase(args, name, (passphrase) =>
    createPaymentSignatureHeader({
      paymentRequired,
      walletAddress,
      walletName: name,
      passphrase
    })
  );
  const paid = await requestJson<unknown>(apiUrl, path, {
    method,
    headers: {
      "idempotency-key": idempotencyKey,
      [X402_HEADERS.paymentSignature]: paymentSignature
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  printJson(assertOk(paid));
}
