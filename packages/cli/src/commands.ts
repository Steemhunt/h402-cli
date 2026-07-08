import { randomUUID } from "node:crypto";
import { assertOk, requestJson } from "./api.js";
import { backendUrl, loadConfig, updateConfig, type CliConfig } from "./config.js";
import { createOwsWallet, getOwsWallet, listOwsWallets, runOwsCli, signOwsMessage } from "./ows.js";
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

type ResolvedWallet = { name: string; address: string };

function isMissingOwsWalletError(error: unknown) {
  return error instanceof Error && /(?:not found|does not exist|no wallet|unknown wallet|wallet .* missing)/i.test(error.message);
}

function isExistingOwsWalletError(error: unknown) {
  return error instanceof Error && /already exists/i.test(error.message);
}

async function adoptOwsWalletByName(name: string, config: CliConfig): Promise<ResolvedWallet | undefined> {
  try {
    const wallet = await getOwsWallet(name);
    const resolved = { name: wallet.name || name, address: wallet.address.toLowerCase() };
    config.wallets[resolved.name] = { address: resolved.address };
    await updateConfig((current) => {
      current.wallets[resolved.name] = { address: resolved.address };
    });
    return resolved;
  } catch (error) {
    if (isMissingOwsWalletError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function adoptOwsWalletByAddress(address: string, config: CliConfig): Promise<ResolvedWallet | undefined> {
  const wallets = await listOwsWallets();
  const match = wallets.find((wallet) => wallet.address.toLowerCase() === address);
  if (!match) return undefined;
  const resolved = { name: match.name, address: match.address.toLowerCase() };
  config.wallets[resolved.name] = { address: resolved.address };
  await updateConfig((current) => {
    current.wallets[resolved.name] = { address: resolved.address };
  });
  return resolved;
}

function normalizeOwsWallets(wallets: ResolvedWallet[]) {
  return wallets.map((wallet) => ({ name: wallet.name, address: wallet.address.toLowerCase() }));
}

async function restoreOwsWallets(config: CliConfig) {
  const wallets = await listOwsWallets();
  let changed = false;
  const restored = normalizeOwsWallets(wallets);
  for (const wallet of restored) {
    if (config.wallets[wallet.name]?.address?.toLowerCase() !== wallet.address) {
      config.wallets[wallet.name] = { address: wallet.address };
      changed = true;
    }
  }
  if (changed) {
    await updateConfig((current) => {
      for (const wallet of restored) {
        current.wallets[wallet.name] = { address: wallet.address };
      }
    });
  }
  return restored;
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
      const adopted = await adoptOwsWalletByName(explicitName, config);
      if (adopted) {
        if (explicitAddress && explicitAddress !== adopted.address) {
          throw new Error(`--wallet ${explicitAddress} does not match wallet "${explicitName}" (${adopted.address}). Omit --wallet or pass the wallet that owns this address.`);
        }
        return adopted;
      }
      throw new Error(`No address known for wallet "${explicitName}". Run: h402 wallet create --name ${explicitName}, or h402 wallet restore to re-adopt existing OWS wallets.`);
    }
    if (explicitAddress && explicitAddress !== address) {
      throw new Error(`--wallet ${explicitAddress} does not match wallet "${explicitName}" (${address}). Omit --wallet or pass the wallet that owns this address.`);
    }
    return { name: explicitName, address };
  }

  if (explicitAddress) {
    const owner = Object.entries(config.wallets).find(([, wallet]) => wallet.address?.toLowerCase() === explicitAddress);
    if (!owner) {
      const adopted = await adoptOwsWalletByAddress(explicitAddress, config);
      if (adopted) return adopted;
      throw new Error(`No local wallet owns address ${explicitAddress}. Create it (h402 wallet create), run h402 wallet restore to re-adopt existing OWS wallets, or select one with --name.`);
    }
    return { name: owner[0], address: explicitAddress };
  }

  const address = config.wallets[DEFAULT_WALLET_NAME]?.address?.toLowerCase();
  if (!address) {
    const adopted = await adoptOwsWalletByName(DEFAULT_WALLET_NAME, config);
    if (adopted) return adopted;
    throw new Error(`No address known for wallet "${DEFAULT_WALLET_NAME}". Run: h402 wallet create --name ${DEFAULT_WALLET_NAME} (or pass --name/--wallet), or h402 wallet restore to re-adopt existing OWS wallets.`);
  }
  return { name: DEFAULT_WALLET_NAME, address };
}

export async function walletCommand(args: ParsedArgs) {
  const subcommand = requireValue(args.positional[1], "wallet subcommand is required");
  const name = walletName(args);
  const config = await loadConfig();

  if (subcommand === "create") {
    let wallet: ResolvedWallet;
    try {
      wallet = await createOwsWallet(name, await createPassphrase(args));
    } catch (error) {
      if (isExistingOwsWalletError(error)) {
        throw new Error(`Wallet "${name}" already exists in the OWS vault. Run: h402 wallet address --name ${name} to re-adopt and print it, or h402 wallet restore to re-adopt all OWS wallets.`);
      }
      throw error;
    }
    config.wallets[name] = { address: wallet.address };
    await updateConfig((current) => {
      current.wallets[name] = { address: wallet.address };
    });
    printJson({ wallet: { name, address: wallet.address } });
    return;
  }

  if (subcommand === "address") {
    printJson({ wallet: await resolveSigningWallet(args, config) });
    return;
  }

  if (subcommand === "list") {
    printJson({ wallets: normalizeOwsWallets(await listOwsWallets()) });
    return;
  }

  if (subcommand === "restore") {
    printJson({ wallets: await restoreOwsWallets(config) });
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

  await updateConfig((current) => {
    current.backendUrl = apiUrl;
    current.sessions[apiUrl] = session.token;
  });
  printJson({ session });
}

export async function searchCommand(args: ParsedArgs) {
  // Validate the required query before any network work.
  const query = requireValue(args.positional.slice(1).join(" ").trim() || undefined, 'search query is required (e.g. h402 search "web search")');
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const result = assertOk(
    await requestJson(apiUrl, `/api/catalog/search?q=${encodeURIComponent(query)}&limit=${flagString(args.flags, "limit", "20")}`)
  );
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
