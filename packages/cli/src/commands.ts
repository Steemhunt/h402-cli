import { randomUUID } from "node:crypto";
import { assertOk, requestJson } from "./api.js";
import { backendUrl, loadConfig, saveConfig, type CliConfig } from "./config.js";
import { createOwsWallet, runOwsCli, signOwsMessage } from "./ows.js";
import { promptPassphrase } from "./prompt.js";
import { buildProxyPath, flagBoolean, flagString, parseJsonFlag, parseQueryFlag, printJson, requireValue, type ParsedArgs } from "./utils.js";
import { createPaymentSignatureHeader, paymentRequiredFromResponse, X402_HEADERS } from "./x402.js";

function walletName(args: ParsedArgs) {
  return flagString(args.flags, "name", "h402") as string;
}

async function walletPassphrase(args: ParsedArgs, options = { confirm: false }) {
  if (flagBoolean(args.flags, "no-passphrase")) {
    return undefined;
  }

  const passphrase = flagString(args.flags, "passphrase", process.env.H402_WALLET_PASSPHRASE);
  if (!passphrase) {
    return promptPassphrase(options);
  }
  return passphrase;
}

async function knownWalletAddress(args: ParsedArgs, config?: CliConfig) {
  config ??= await loadConfig();
  const explicit = flagString(args.flags, "wallet");
  if (explicit) return explicit.toLowerCase();

  const name = walletName(args);
  const address = config.wallets[name]?.address;
  if (!address) {
    throw new Error(`No address known for wallet "${name}". Run h402 wallet create --name ${name} or pass --wallet.`);
  }
  return address;
}

export async function walletCommand(args: ParsedArgs) {
  const subcommand = requireValue(args.positional[1], "wallet subcommand is required");
  const name = walletName(args);
  const config = await loadConfig();

  if (subcommand === "create") {
    const wallet = await createOwsWallet(name, await walletPassphrase(args, { confirm: true }));
    config.wallets[name] = { address: wallet.address };
    await saveConfig(config);
    printJson({ wallet: { name, address: wallet.address } });
    return;
  }

  if (subcommand === "address") {
    printJson({ wallet: { name, address: await knownWalletAddress(args, config) } });
    return;
  }

  if (subcommand === "balance") {
    const output = await runOwsCli(["fund", "balance", "--wallet", name, "--chain", "base"]);
    process.stdout.write(`${output}\n`);
    return;
  }

  if (subcommand === "fund") {
    const output = await runOwsCli(["fund", "deposit", "--wallet", name, "--chain", "8453", "--token", "USDC"]);
    process.stdout.write(`${output}\n`);
    return;
  }

  throw new Error(`Unknown wallet subcommand: ${subcommand}`);
}

export async function authCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const address = await knownWalletAddress(args, config);
  const name = walletName(args);
  const challenge = assertOk(
    await requestJson<{ challenge: { message: string } }>(apiUrl, "/api/auth/challenge", {
      method: "POST",
      body: JSON.stringify({ address })
    })
  ).challenge;
  const signature = await signOwsMessage(name, challenge.message, await walletPassphrase(args));
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

export async function searchCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const query = args.positional.slice(1).join(" ");
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
  const method = (flagString(args.flags, "method") ?? (body === undefined ? "GET" : "POST")) as "GET" | "POST";
  const result = await requestJson(apiUrl, buildProxyPath(routeId, query, provider), {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const paymentRequired = paymentRequiredFromResponse(result.headers, result.body);

  printJson(paymentRequired ? { paymentRequired } : result.body);
}

export async function callCommand(args: ParsedArgs) {
  const config = await loadConfig();
  const apiUrl = backendUrl(config, flagString(args.flags, "api-url"));
  const routeId = requireValue(args.positional[1], "route id is required");
  const body = parseJsonFlag(args.flags);
  const query = parseQueryFlag(args.flags);
  const provider = flagString(args.flags, "provider");
  const method = (flagString(args.flags, "method") ?? (body === undefined ? "GET" : "POST")) as "GET" | "POST";
  const idempotencyKey = flagString(args.flags, "idempotency-key", randomUUID()) as string;
  const token = config.sessions[apiUrl];
  const walletAddress = await knownWalletAddress(args, config);
  const name = walletName(args);
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

  if (first.status !== 402) {
    printJson(first.body);
    return;
  }

  const paymentRequired = paymentRequiredFromResponse(first.headers, first.body);
  if (!paymentRequired) {
    printJson(first.body);
    return;
  }

  const paymentSignature = await createPaymentSignatureHeader({
    paymentRequired,
    walletAddress,
    walletName: name,
    passphrase: await walletPassphrase(args)
  });
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
