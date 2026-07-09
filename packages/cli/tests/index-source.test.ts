import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(path.join(here, "..", "src", "index.ts"), "utf8");

describe("CLI process lifecycle", () => {
  it("does not force process.exit before stdout/stderr drains", () => {
    expect(indexSource).not.toContain("process.exit(");
    expect(indexSource).toContain("process.exitCode");
  });
});
