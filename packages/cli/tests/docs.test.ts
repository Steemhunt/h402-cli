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

  it("documents wallet-free routes and conditional payment fields", () => {
    for (const file of Object.values(DOC_FILES)) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("Browsing, quoting, and free-route calls do not require a local wallet.");
      expect(text).toContain("A funded local wallet is required only if the first response is a payable `402`.");
      expect(text).toContain("Wallet creation creates a local signing wallet only; `h402 auth` creates the optional bonus-credit session.");
      expect(text).toContain("h402 call ai/news");
      expect(text).toContain("`ledgerEntryId` is present for credit or x402-paid calls");
      expect(text).toContain("`paymentTransaction` and CLI-added `signedAmount` are x402-payment-only fields");
      expect(text).toContain("free calls omit all three");
      expect(text).not.toMatch(/(?:the|a) first request returns `?402`?/i);

      // An initial 2xx is not necessarily free: with an authenticated session,
      // bonus credits can cover a paid route. Classification lives in h402.paidBy.
      expect(text).toContain(
        "An initial 2xx is returned directly — `h402.paidBy` says whether it was `free` (no charge) or covered by bonus `credit` from an authenticated session."
      );
      expect(text).not.toMatch(/free route returns (?:its|a) direct\s+2xx result/i);
      expect(text).not.toMatch(/2xx → return the free JSON result/);
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
