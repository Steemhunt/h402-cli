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
    it(`${label}: docs do not describe web/search limit as provider-native`, () => {
      // After h402-web#417/#415, `limit` is a common canonical field for web/search auto.
      // Docs must not steer agents into unnecessary provider pinning for this field.
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/limit[^\n]+web\/search[^\n]+provider-specific/i);
      expect(text).not.toMatch(/provider-specific[^\n]+limit[^\n]+web\/search/i);
    });

    it(`${label}: web/search call examples send no provider-native field on the auto route`, () => {
      // Auto examples may use canonical fields such as query/limit, but must not send
      // documented provider-native fields unless they also pin the owning provider.
      const offenders = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.includes("h402 call web/search") && line.includes("mode") && !line.includes("--provider"));
      expect(offenders).toEqual([]);
    });

    it(`${label}: response envelope docs include optional meta and h402 followUp`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain('"meta"?: <pagination/provider metadata>');
      expect(text).toContain("followUp");
      expect(text).toContain("paymentTransaction");
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
});
