import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
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

// `npm install -g @h402/cli` installs @open-wallet-standard/core (and its `ows`
// binary) into the dependency tree, but npm only links the *top-level* package's
// bin onto PATH — so bare `ows` is usually missing after a global install. Locate
// the bundled binary so wallet commands work out of the box.
function bundledOwsBinary(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve("@open-wallet-standard/core/package.json");
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { bin?: string | Record<string, string> };
    const binRelative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.ows;
    if (!binRelative) {
      return null;
    }
    const binPath = path.join(path.dirname(packageJsonPath), binRelative);
    return existsSync(binPath) ? binPath : null;
  } catch {
    return null;
  }
}

// Resolve how to invoke OWS: an explicit H402_OWS_BIN wins; otherwise prefer the
// bundled wrapper (run with the current Node so the `#!/usr/bin/env node` shim is
// not needed on PATH); fall back to bare `ows` on PATH only when the bundled
// wrapper file is absent. Note: the bundled wrapper resolves its own native
// binary at run time, so if that platform binary is missing (e.g. an
// `--omit=optional` install) the wrapper errors rather than falling back — set
// H402_OWS_BIN to a working `ows` in that case.
export function resolveOwsInvocation(): { command: string; prefixArgs: string[] } {
  const override = process.env.H402_OWS_BIN;
  if (override) {
    return { command: override, prefixArgs: [] };
  }
  const bundled = bundledOwsBinary();
  if (bundled) {
    return { command: process.execPath, prefixArgs: [bundled] };
  }
  return { command: "ows", prefixArgs: [] };
}

export function runOwsCli(args: string[]) {
  const { command, prefixArgs } = resolveOwsInvocation();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...prefixArgs, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      reject(
        new Error(
          `Could not run the OWS wallet binary${code ? ` (${code})` : ""}. Set H402_OWS_BIN to an absolute 'ows' path, ` +
            "or reinstall @h402/cli so its bundled OWS binary is available (e.g. without --omit=optional)."
        )
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `ows exited with code ${code}`));
      }
    });
  });
}
