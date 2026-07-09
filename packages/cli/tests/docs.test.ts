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
    });
    it(`${label}: documents the current call envelope and async follow-up contract`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain('"meta"?: <contract metadata>');
      expect(text).toContain("paymentTransaction");
      expect(text).toContain("h402.followUp");
      expect(text).toContain("params.jobId");
      expect(text).not.toContain('Provider-specific fields (e.g. `limit` on `web/search`)');
    });
  }
});
