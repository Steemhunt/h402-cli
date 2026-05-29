import { spawn } from "node:child_process";
import { createWallet, signMessage, signTypedData, type WalletInfo } from "@open-wallet-standard/core";

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HEX_SIGNATURE_PATTERN = /^(0x)?[a-fA-F0-9]+$/;

export function getEvmAddress(wallet: WalletInfo) {
  const account =
    wallet.accounts.find((candidate) => candidate.chainId === "eip155:8453") ??
    wallet.accounts.find((candidate) => candidate.chainId.startsWith("eip155:")) ??
    wallet.accounts.find((candidate) => EVM_ADDRESS_PATTERN.test(candidate.address));

  if (!account || !EVM_ADDRESS_PATTERN.test(account.address)) {
    throw new Error("OWS wallet was created but no EVM address was returned");
  }

  return account.address.toLowerCase();
}

export async function createOwsWallet(name: string, passphrase?: string) {
  const wallet = createWallet(name, passphrase);
  return { name, address: getEvmAddress(wallet), wallet };
}

export function normalizeOwsSignature(signature: string, recoveryId?: number) {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  if (!HEX_SIGNATURE_PATTERN.test(normalized)) {
    throw new Error("OWS signMessage returned a non-hex signature");
  }

  if (normalized.length === 132) {
    return normalized as `0x${string}`;
  }

  if (normalized.length === 130 && recoveryId !== undefined) {
    const v = recoveryId > 1 ? recoveryId : recoveryId + 27;
    return `${normalized}${v.toString(16).padStart(2, "0")}` as `0x${string}`;
  }

  throw new Error("OWS signMessage returned an invalid EVM signature length");
}

export async function signOwsMessage(walletName: string, message: string, passphrase?: string) {
  const result = signMessage(walletName, "base", message, passphrase);
  return normalizeOwsSignature(result.signature, result.recoveryId);
}

export async function signOwsTypedData(walletName: string, typedData: unknown, passphrase?: string) {
  const result = signTypedData(walletName, "base", JSON.stringify(typedData), passphrase);
  return normalizeOwsSignature(result.signature, result.recoveryId);
}

export function runOwsCli(args: string[]) {
  const executable = process.env.H402_OWS_BIN ?? "ows";
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `ows exited with code ${code}`));
      }
    });
  });
}
