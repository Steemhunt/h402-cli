import { spawn } from "node:child_process";

type OwsCore = {
  createWallet?: (name: string, passphrase?: string | null, words?: number | null, vaultPath?: string | null) => unknown | Promise<unknown>;
  signMessage?: (
    walletName: string,
    chain: string,
    message: string,
    passphrase?: string | null,
    encoding?: string | null,
    index?: number | null,
    vaultPath?: string | null
  ) => unknown | Promise<unknown>;
};

function findEvmAddress(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const maybeAddress = (value as { address?: unknown }).address;
  if (typeof maybeAddress === "string" && /^0x[a-fA-F0-9]{40}$/.test(maybeAddress)) {
    return maybeAddress.toLowerCase();
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(entry)) {
      const found = entry.map(findEvmAddress).find(Boolean);
      if (found) return found;
    }

    const found = findEvmAddress(entry);
    if (found) return found;
  }

  return undefined;
}

async function owsCore() {
  try {
    return (await import("@open-wallet-standard/core")) as OwsCore;
  } catch (error) {
    throw new Error(
      `Could not load @open-wallet-standard/core. Run npm install in h402-cli first. ${error instanceof Error ? error.message : ""}`
    );
  }
}

export async function createOwsWallet(name: string, passphrase: string) {
  const core = await owsCore();
  if (!core.createWallet) {
    throw new Error("@open-wallet-standard/core does not expose createWallet");
  }

  const wallet = await core.createWallet(name, passphrase);
  const address = findEvmAddress(wallet);
  if (!address) {
    throw new Error("OWS wallet was created but no EVM address was returned");
  }

  return { name, address, wallet };
}

export async function signOwsMessage(walletName: string, message: string, passphrase: string) {
  const core = await owsCore();
  if (!core.signMessage) {
    throw new Error("@open-wallet-standard/core does not expose signMessage");
  }

  const result = await core.signMessage(walletName, "evm", message, passphrase);
  if (typeof result === "string") {
    return result;
  }

  const signature = result && typeof result === "object" ? (result as { signature?: unknown }).signature : undefined;
  if (typeof signature !== "string") {
    throw new Error("OWS signMessage did not return a signature");
  }
  return signature;
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
