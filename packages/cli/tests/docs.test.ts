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

  it("payable token-holder examples use one valid catalog address instead of an EVM placeholder", () => {
    const validInput = '{"tokenAddress":"0x37f0c2915CeCC7e977183B8543Fc0864d03E064C","chain":"base"}';
    for (const label of ["package README.md", "SKILL.md"]) {
      expect(readFileSync(DOC_FILES[label], "utf8")).toContain(validInput);
    }
    for (const file of Object.values(DOC_FILES)) {
      expect(readFileSync(file, "utf8")).not.toMatch(/"tokenAddress"\s*:\s*"0x(?:\.{3}|…)+"/i);
    }
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

  it("documents capability-aware auto routing and provider-bound async follow-ups", () => {
    const asyncRouteConvention =
      "Async parent route IDs end in `-async`; a single-parent follow-up is `<parent-route>-status`, while shared multi-parent follow-ups may use a shared `*-status` name.";
    for (const file of Object.values(DOC_FILES)) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("Auto routing capability-routes provider-native input to an enabled candidate whose strict schema accepts it.");
      expect(text).toContain("Use `--provider` only for determinism, deliberate provider selection, or provider-bound follow-ups.");
      expect(text).toContain(asyncRouteConvention);
      expect(text).toContain("h402 call <followUp.routeId>");
      expect(text).toContain("--provider <provider-from-followUp.path>");
      expect(text).not.toMatch(/provider-specific fields[^\n]+require pinning/i);

      // The template must stay method-aware: GET polls use --query, POST polls
      // use --json — the CLI rejects --query combined with POST.
      expect(text).toContain("Match `followUp.method` — GET params go via `--query`, POST bodies via `--json`; the CLI rejects `--query` on a POST");
      expect(text).toContain("# followUp.method GET (most status polls):");
      expect(text).toContain("--query '<followUp.params>'");
      expect(text).toContain("# followUp.method POST (e.g. ai/music-generate-async-status):");
      expect(text).not.toContain("ai/music-status-async");
      expect(text).toContain("--json '<followUp.params>'");
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
