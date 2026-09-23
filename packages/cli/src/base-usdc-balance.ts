import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, USDC_DECIMALS } from "@h402/core";
import { fetch, type RequestInit, type Response } from "undici";
import { networkErrorMessage } from "./errors.js";

export const BASE_RPC_URLS = [
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
  "https://1rpc.io/base"
] as const;

const BALANCE_OF_SELECTOR = "70a08231";
const RPC_TIMEOUT_MS = 5_000;
const EVM_ADDRESS = /^0[xX][0-9a-fA-F]{40}$/;

type RpcFetch = (input: string, init: RequestInit) => Promise<Response>;

type BalanceOptions = {
  rpcUrls?: readonly string[];
  fetchFn?: RpcFetch;
  timeoutMs?: number;
};

export type BaseUsdcBalance = {
  microUsdc: string;
  usdc: string;
};

export const BASE_USDC_BALANCE_NETWORK = {
  name: "base",
  chainId: BASE_CHAIN_ID
} as const;

export const BASE_USDC_BALANCE_ASSET = {
  symbol: "USDC",
  address: BASE_USDC_ADDRESS,
  decimals: USDC_DECIMALS
} as const;

function normalizeAddress(address: string) {
  if (!EVM_ADDRESS.test(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  return address.toLowerCase();
}

export function balanceOfCalldata(address: string) {
  const normalized = normalizeAddress(address);
  return `0x${BALANCE_OF_SELECTOR}${normalized.slice(2).padStart(64, "0")}`;
}

function jsonRpcErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "number" || typeof record.code === "string" ? `${record.code}: ` : "";
  const message = typeof record.message === "string" ? record.message : JSON.stringify(error);
  return `${code}${message}`;
}

function parseRpcBalance(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("RPC returned a non-object response");
  }
  const response = body as { result?: unknown; error?: unknown };
  if (response.error !== undefined) {
    throw new Error(`RPC error: ${jsonRpcErrorMessage(response.error)}`);
  }
  if (typeof response.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(response.result)) {
    throw new Error("RPC returned an invalid balance result");
  }
  return BigInt(response.result === "0x" ? "0x0" : response.result);
}

async function rpcBalance(url: string, calldata: string, fetchFn: RpcFetch, signal: AbortSignal) {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        {
          to: BASE_USDC_ADDRESS,
          data: calldata
        },
        "latest"
      ]
    }),
    signal
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("RPC returned non-JSON response");
  }
  return parseRpcBalance(body);
}

function quorumUnavailableError(outcomes: string[], rpcHosts: readonly string[]) {
  const diagnostics = outcomes.map((outcome, index) => `${rpcHosts[index]}: ${outcome.replace(/\s+/g, " ").slice(0, 200)}`).join("; ");
  return new Error(`Base USDC balance is temporarily unavailable: RPC quorum failed; need two matching Base RPC responses. ${diagnostics}`);
}

function firstMatchingQuorum(calls: Promise<bigint>[], rpcHosts: readonly string[]) {
  return new Promise<bigint>((resolve, reject) => {
    let settled = 0;
    let finished = false;
    const values = new Map<string, { value: bigint; count: number }>();
    const outcomes: string[] = [];

    for (const [index, call] of calls.entries()) {
      call
        .then((value) => {
          if (finished) return;
          settled += 1;
          outcomes[index] = `${value} microUSDC`;
          const key = value.toString();
          const entry = values.get(key) ?? { value, count: 0 };
          entry.count += 1;
          values.set(key, entry);
          if (entry.count >= 2) {
            finished = true;
            resolve(entry.value);
            return;
          }
          if (settled === calls.length) {
            finished = true;
            reject(quorumUnavailableError(outcomes, rpcHosts));
          }
        })
        .catch((error: unknown) => {
          if (finished) return;
          settled += 1;
          outcomes[index] = networkErrorMessage(error);
          if (settled === calls.length) {
            finished = true;
            reject(quorumUnavailableError(outcomes, rpcHosts));
          }
        });
    }
  });
}

function formatUsdc(microUsdc: bigint) {
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = microUsdc / scale;
  const fraction = (microUsdc % scale).toString().padStart(USDC_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

export async function getBaseUsdcBalance(address: string, options: BalanceOptions = {}): Promise<BaseUsdcBalance> {
  const rpcUrls = options.rpcUrls ?? BASE_RPC_URLS;
  if (rpcUrls.length < 2) {
    throw new Error("At least two Base RPC URLs are required for quorum.");
  }
  const rpcHosts = rpcUrls.map((url) => new URL(url).host);
  const fetchFn = options.fetchFn ?? fetch;
  const calldata = balanceOfCalldata(address);
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  const controllers = rpcUrls.map(() => new AbortController());
  const timers = controllers.map((controller) => setTimeout(() => controller.abort(), timeoutMs));
  const calls = rpcUrls.map((url, index) =>
    rpcBalance(url, calldata, fetchFn, controllers[index].signal).catch((error) => {
      throw new Error(controllers[index].signal.aborted ? `timed out after ${timeoutMs}ms` : networkErrorMessage(error).replaceAll(url, rpcHosts[index]));
    })
  );

  try {
    const microUsdc = await firstMatchingQuorum(calls, rpcHosts);
    return {
      microUsdc: microUsdc.toString(),
      usdc: formatUsdc(microUsdc)
    };
  } finally {
    for (const timer of timers) clearTimeout(timer);
    for (const controller of controllers) controller.abort();
  }
}
