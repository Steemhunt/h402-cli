import { afterEach, describe, expect, it, vi } from "vitest";
import { createPassphrase, signWithWalletPassphrase } from "../src/commands";
import type { ParsedArgs } from "../src/utils";

function args(flags: Record<string, string | boolean> = {}): ParsedArgs {
  return { positional: [], flags };
}

const DECRYPTION_FAILED = new Error("decryption failed: aead::Error");

afterEach(() => {
  delete process.env.H402_WALLET_PASSPHRASE;
  vi.restoreAllMocks();
});

// Wallets are passphrase-less by default: signing runs with no flags, no env,
// and no prompt. Only a passphrase-protected keystore escalates.
describe("signWithWalletPassphrase", () => {
  it("signs the default passphrase-less wallet with zero flags and no prompt", async () => {
    const sign = vi.fn().mockResolvedValue("0xsig");
    await expect(signWithWalletPassphrase(args(), "agent", sign)).resolves.toBe("0xsig");
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith(undefined);
  });

  it("names H402_WALLET_PASSPHRASE only when the wallet is actually protected (non-interactive)", async () => {
    const sign = vi.fn().mockRejectedValue(DECRYPTION_FAILED);
    await expect(signWithWalletPassphrase(args(), "vault", sign)).rejects.toThrow(
      'Wallet "vault" is passphrase-protected. Set H402_WALLET_PASSPHRASE (or pass --passphrase <s>) for non-interactive use.'
    );
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("passes an explicit --passphrase through and reports a rejected one", async () => {
    const ok = vi.fn().mockResolvedValue("0xsig");
    await expect(signWithWalletPassphrase(args({ passphrase: "secret" }), "vault", ok)).resolves.toBe("0xsig");
    expect(ok).toHaveBeenCalledWith("secret");

    const bad = vi.fn().mockRejectedValue(DECRYPTION_FAILED);
    await expect(signWithWalletPassphrase(args({ passphrase: "wrong" }), "vault", bad)).rejects.toThrow(
      'Wallet "vault" rejected the passphrase from --passphrase / H402_WALLET_PASSPHRASE.'
    );
  });

  it("uses H402_WALLET_PASSPHRASE when exported and lets --no-passphrase override it", async () => {
    process.env.H402_WALLET_PASSPHRASE = "env-secret";
    const sign = vi.fn().mockResolvedValue("0xsig");
    await signWithWalletPassphrase(args(), "vault", sign);
    expect(sign).toHaveBeenCalledWith("env-secret");

    const skipped = vi.fn().mockResolvedValue("0xsig");
    await signWithWalletPassphrase(args({ "no-passphrase": true }), "agent", skipped);
    expect(skipped).toHaveBeenCalledWith(undefined);
  });

  it("does not prompt when --no-passphrase hits a protected wallet", async () => {
    const sign = vi.fn().mockRejectedValue(DECRYPTION_FAILED);
    await expect(signWithWalletPassphrase(args({ "no-passphrase": true }), "vault", sign)).rejects.toThrow(
      'Wallet "vault" is passphrase-protected, but --no-passphrase was passed.'
    );
  });

  it("re-throws non-passphrase signing errors untouched", async () => {
    const sign = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(signWithWalletPassphrase(args(), "agent", sign)).rejects.toThrow("network down");
  });
});

describe("createPassphrase", () => {
  it("creates passphrase-less by default", async () => {
    await expect(createPassphrase(args())).resolves.toBeUndefined();
  });

  it("opts in via --passphrase <s> and force-skips via --no-passphrase", async () => {
    await expect(createPassphrase(args({ passphrase: "secret" }))).resolves.toBe("secret");
    process.env.H402_WALLET_PASSPHRASE = "env-secret";
    await expect(createPassphrase(args())).resolves.toBe("env-secret");
    await expect(createPassphrase(args({ "no-passphrase": true }))).resolves.toBeUndefined();
  });

  it("rejects a bare --passphrase in non-interactive use instead of prompting", async () => {
    await expect(createPassphrase(args({ passphrase: true }))).rejects.toThrow(
      "Bare --passphrase prompts interactively; pass --passphrase <s> or set H402_WALLET_PASSPHRASE in non-interactive use."
    );
  });
});
