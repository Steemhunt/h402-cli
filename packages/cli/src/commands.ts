import { randomUUID } from "node:crypto";
import { assertOk, requestJson } from "./api.js";
import { BASE_USDC_BALANCE_ASSET, BASE_USDC_BALANCE_NETWORK, getBaseUsdcBalance } from "./base-usdc-balance.js";
import { backendUrl, loadConfig, updateConfig, type CliConfig } from "./config.js";
import { CliError } from "./errors.js";
import { createOwsWallet, getOwsWallet, listOwsWallets, signOwsMessage } from "./ows.js";
import { promptPassphrase } from "./prompt.js";
import { buildProxyPath, flagBoolean, flagString, parseJsonFlag, parseQueryFlag, printJson, requireValue, resolveMethod, type ParsedArgs } from "./utils.js";
import { createPaymentSignatureHeader, paymentRequiredFromResponse, selectBaseUsdcRequirement, X402_HEADERS } from "./x402.js";

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

function withIdempotencyKey(error: unknown, idempotencyKey: string) {
  const existingDetail = error instanceof CliError ? error.detail : undefined;
  const detail = existingDetail && typeof existingDetail === "object" && !Array.isArray(existingDetail)
    ? { ...(existingDetail as Record<string, unknown>), idempotencyKey }
    : { idempotencyKey, ...(existingDetail === undefined ? {} : { detail: existingDetail }) };
  const message = `${error instanceof Error ? error.message : String(error)} (idempotency-key: ${idempotencyKey})`;
  return new CliError(message, detail);
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
    await printJson({ wallet: { name, address: wallet.address } });
    return;
  }

  if (subcommand === "address") {
    await printJson({ wallet: await resolveSigningWallet(args, config) });
    return;
  }

  if (subcommand === "list") {
    await printJson({ wallets: normalizeOwsWallets(await listOwsWallets()) });
    return;
  }

  if (subcommand === "restore") {
    await printJson({ wallets: await restoreOwsWallets(config) });
    return;
  }

  if (subcommand === "balance") {
    const { name: signingName, address } = await resolveSigningWallet(args, config);
    await printJson({
      wallet: { name: signingName, address },
      network: BASE_USDC_BALANCE_NETWORK,
      asset: BASE_USDC_BALANCE_ASSET,
      balance: await getBaseUsdcBalance(address)
    });
    return;
  }

  if (subcommand === "fund") {
    const { name: signingName, address } = await resolveSigningWallet(args, config);
    await printJson({
      wallet: { name: signingName, address },
      network: "base",
      token: "USDC",
      instructions: `Send Base USDC to this address from an exchange, bridge, or another wallet, then run h402 wallet balance --name ${signingName}.`
    });
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
  await printJson({ session: { address: session.address, expiresAt: session.expiresAt } });
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
  await printJson(result);
}

export async function creditsCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const token = config.sessions[apiUrl];
  if (!token) {
    throw new Error("No session token. Run h402 auth first.");
  }

  await printJson(assertOk(await requestJson(apiUrl, "/api/me/credits", { token })));
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
    await printJson({ paymentRequired });
    return;
  }
  // No challenge: a free route returns its result with a 2xx. Any non-2xx
  // (404/500/...) is a real error and must exit non-zero, not print as a result.
  await printJson(assertOk(result));
}

function parseUsdMicros(raw: string, source: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) {
    throw new Error(`${source} must be a non-negative USD amount with at most 6 decimal places (got "${raw}").`);
  }
  const [whole, fractional = ""] = raw.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fractional.padEnd(6, "0"));
  if (micros < 0n) {
    throw new Error(`${source} must be non-negative (got "${raw}").`);
  }
  return micros;
}

function parseBaseUsdcMicros(raw: unknown, source: string) {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new Error(`${source} must be an unsigned integer amount in USDC micros (got ${JSON.stringify(raw)}).`);
  }
  return BigInt(raw);
}

function formatUsdMicros(amount: string | bigint) {
  const micros = typeof amount === "bigint" ? amount : parseBaseUsdcMicros(amount, "x402 payment amount");
  const whole = micros / 1_000_000n;
  const fractional = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

function maxUsd(args: ParsedArgs, config: CliConfig) {
  if (args.flags["max-usd"] === true) {
    throw new Error("Flag --max-usd requires a USD amount, for example --max-usd 0.05.");
  }
  const raw = flagString(args.flags, "max-usd", config.maxUsd);
  return raw === undefined ? undefined : { raw, micros: parseUsdMicros(raw, "--max-usd / config.maxUsd") };
}

function assertUnderMaxUsd(amount: string, cap: ReturnType<typeof maxUsd>) {
  const amountMicros = parseBaseUsdcMicros(amount, "x402 payment amount");
  if (!cap) return;
  if (amountMicros > cap.micros) {
    throw new Error(`Payment amount $${formatUsdMicros(amountMicros)} USDC exceeds --max-usd ${cap.raw}; refusing to sign.`);
  }
}

function withSignedAmount(body: unknown, accepted: { amount: string }) {
  const amountMicros = parseBaseUsdcMicros(accepted.amount, "x402 payment amount");
  const signedAmount = { amount: accepted.amount, asset: "USDC", decimals: 6, usd: formatUsdMicros(amountMicros) };
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const h402 = record.h402 && typeof record.h402 === "object" && !Array.isArray(record.h402) ? (record.h402 as Record<string, unknown>) : {};
    return { ...record, h402: { ...h402, signedAmount } };
  }
  return { data: body, h402: { signedAmount } };
}

function authorizationClockFromResponseDate(headers: Headers) {
  const date = headers.get("date");
  if (!date) return undefined;
  const millis = Date.parse(date);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : undefined;
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
  const paymentCap = maxUsd(args, config);
  const token = config.sessions[apiUrl];
  const path = buildProxyPath(routeId, query, provider);
  const headers: Record<string, string> = {
    "idempotency-key": idempotencyKey
  };

  if (token && !flagBoolean(args.flags, "no-credit")) {
    headers.authorization = `Bearer ${token}`;
  }

  try {
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
      await printJson(assertOk(first));
      return;
    }

    const accepted = selectBaseUsdcRequirement(paymentRequired);
    assertUnderMaxUsd(accepted.amount, paymentCap);
    const { name, address: walletAddress } = await resolveSigningWallet(args, config);
    const paymentSignature = await signWithWalletPassphrase(args, name, (passphrase) =>
      createPaymentSignatureHeader({
        paymentRequired,
        walletAddress,
        walletName: name,
        passphrase,
        authorizationNow: authorizationClockFromResponseDate(first.headers)
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

    await printJson(withSignedAmount(assertOk(paid), accepted));
  } catch (error) {
    throw withIdempotencyKey(error, idempotencyKey);
  }
}
