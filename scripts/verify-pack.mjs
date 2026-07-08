// Release guard: assert each publishable workspace's npm tarball actually
// contains its compiled `dist`. `npm pack` runs the package's `prepack` (which
// builds `dist`), so this fails loudly if the build/packaging wiring ever
// regresses and a tarball would ship without its JS/types.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED = {
  "@h402/core": ["dist/index.js", "dist/index.d.ts"],
  "@h402/cli": ["dist/index.js"]
};

const FORBIDDEN_MANIFEST_FIELDS = {
  "@h402/cli": ["os", "cpu"]
};

let failed = false;
const work = mkdtempSync(join(tmpdir(), "h402-pack-verify-"));

try {
  for (const [pkg, required] of Object.entries(REQUIRED)) {
    const stdout = execFileSync("npm", ["pack", "--json", "--pack-destination", work, "--workspace", pkg], { encoding: "utf8" });
    const pack = JSON.parse(stdout)[0];
    const packed = new Set((pack?.files ?? []).map((file) => file.path));
    const missing = required.filter((path) => !packed.has(path));
    if (missing.length > 0) {
      failed = true;
      console.error(`✗ ${pkg}: tarball is missing ${missing.join(", ")}`);
    } else {
      console.log(`✓ ${pkg}: tarball includes ${required.join(", ")}`);
    }

    const forbiddenFields = FORBIDDEN_MANIFEST_FIELDS[pkg] ?? [];
    if (forbiddenFields.length > 0) {
      const manifest = JSON.parse(execFileSync("tar", ["-xOf", join(work, pack.filename), "package/package.json"], { encoding: "utf8" }));
      const present = forbiddenFields.filter((field) => Object.prototype.hasOwnProperty.call(manifest, field));
      if (present.length > 0) {
        failed = true;
        console.error(`✗ ${pkg}: packed manifest must not include ${present.join(", ")}`);
      } else {
        console.log(`✓ ${pkg}: packed manifest has no ${forbiddenFields.join(" or ")} restrictions`);
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed) {
  console.error("\nPack verification failed — the published package would be broken. Build before publishing (prepack should do this automatically).");
  process.exit(1);
}

console.log("\nPack verification passed.");
