import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
// tests/ -> packages/cli -> packages -> repo root
const DOC_FILES: Record<string, string> = {
  "root README.md": path.join(here, "..", "..", "..", "README.md"),
  "package README.md": path.join(here, "..", "README.md"),
  "SKILL.md": path.join(here, "..", "..", "..", "SKILL.md")
};

describe("doc examples stay runnable against the catalog contract", () => {
  for (const [label, file] of Object.entries(DOC_FILES)) {
    it(`${label}: does not describe web/search limit as provider-specific`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toMatch(/`web\/search` (accepts common fields such as `query` and `limit`|fields such as `query` and `limit` are common fields)/);
      expect(text).not.toContain('Provider-specific fields (e.g. `limit` on `web/search`)');
      expect(text).not.toMatch(/limit[^\n]+web\/search[^\n]+provider-specific/i);
      expect(text).not.toMatch(/provider-specific[^\n]+limit[^\n]+web\/search/i);
    });

    it(`${label}: documents the current call envelope and async follow-up contract`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain('"meta"?: <contract metadata>');
      expect(text).toContain("paymentTransaction");
      expect(text).toContain("h402.followUp");
      expect(text).toContain("params.jobId");
      expect(text).not.toContain('Provider-specific fields (e.g. `limit` on `web/search`)');
      expect(text).not.toContain('{ "data": <provider result>, "h402": <routing metadata> }');
    });
  }

  it("package README flag table matches command-specific strict flag handling", () => {
    const text = readFileSync(DOC_FILES["package README.md"], "utf8");
    expect(text).toContain("| `--name <wallet>` | wallet create/address/balance/fund; auth; call |");
    expect(text).toContain("| `--wallet 0x...` | wallet address/balance/fund; auth; call |");
    expect(text).toContain("| `--api-url <url>` | auth, credits, search, quote, call |");
    expect(text).toContain("| `--passphrase [<s>]` | wallet create, auth, call |");
    expect(text).toContain("| `--no-passphrase` | wallet create, auth, call |");
    expect(text).not.toContain("| `--name <wallet>` | all |");
    expect(text).not.toContain("| `--wallet 0x...` | all |");
    expect(text).not.toContain("| `--api-url <url>` | all |");
  });

  it("keeps OWS native platform support and preflight guidance synchronized", () => {
    const supported = "OWS wallet creation and signing use native bindings available only on macOS and glibc-based Linux, on x64 or arm64.";
    // Native-only operations are enumerated precisely: config-mapped wallets keep
    // address/balance/fund working without bindings, so "manage wallets" is too broad.
    const unsupported =
      "Windows, musl/Alpine, and other OS/architecture combinations can still run `--help`, `search`, `quote`, and free-route `call`, but cannot create, list, restore, or auto-adopt wallets, run `h402 auth`, or sign a payable call until OWS ships a matching native binding.";
    const configMapped =
      "`wallet address`, `wallet balance`, and `wallet fund` keep working for wallets already mapped in `~/.h402/config.json` — but USDC funded from an unsupported host can only be spent by signing on a supported platform.";
    const preflight = "Before creating or funding a wallet, run `h402 wallet list` as a read-only native-binding preflight.";
    for (const file of Object.values(DOC_FILES)) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain(supported);
      expect(text).toContain(unsupported);
      expect(text).toContain(configMapped);
      expect(text).toContain(preflight);
      expect(text).not.toMatch(/bundles? (?:the )?`?ows`? wallet binary/i);
      expect(text).not.toMatch(/cannot manage wallets/i);
    }
  });

  it("core README scopes selectExactRequirement to h402 canonical challenges", () => {
    const text = readFileSync(path.join(here, "..", "..", "core", "README.md"), "utf8");
    expect(text).toContain("`selectExactRequirement` is intentionally h402-opinionated");
    expect(text).toContain("strict CAIP-2 `eip155:8453`");
    expect(text).toContain("short-form network names");
    expect(text).toContain("supply your own selector");
  });
});
