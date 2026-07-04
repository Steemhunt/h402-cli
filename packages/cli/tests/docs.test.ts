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
    it(`${label}: web/search call examples send no provider-native field on the auto route`, () => {
      // web/search's `limit` is provider-native: an unpinned (auto) example that sends it
      // 422s on the first call (provider_native_field_requires_pinning). A documented call
      // must omit it unless it also pins the owning provider with --provider.
      const offenders = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.includes("h402 call web/search") && line.includes("limit") && !line.includes("--provider"));
      expect(offenders).toEqual([]);
    });

    it(`${label}: response envelope docs include optional meta and h402 followUp`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain('"meta"?: <pagination/provider metadata>');
      expect(text).toContain("followUp");
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
