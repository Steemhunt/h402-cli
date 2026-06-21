// Release guard: assert each publishable workspace's npm tarball actually
// contains its compiled `dist`. `npm pack --dry-run` runs the package's
// `prepack` (which builds `dist`), so this fails loudly if the build/packaging
// wiring ever regresses and a tarball would ship without its JS/types.
import { execFileSync } from "node:child_process";

const REQUIRED = {
  "@h402/core": ["dist/index.js", "dist/index.d.ts"],
  "@h402/cli": ["dist/index.js"]
};

let failed = false;

for (const [pkg, required] of Object.entries(REQUIRED)) {
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json", "--workspace", pkg], { encoding: "utf8" });
  const packed = new Set((JSON.parse(stdout)[0]?.files ?? []).map((file) => file.path));
  const missing = required.filter((path) => !packed.has(path));
  if (missing.length > 0) {
    failed = true;
    console.error(`✗ ${pkg}: tarball is missing ${missing.join(", ")}`);
  } else {
    console.log(`✓ ${pkg}: tarball includes ${required.join(", ")}`);
  }
}

if (failed) {
  console.error("\nPack verification failed — the published package would be broken. Build before publishing (prepack should do this automatically).");
  process.exit(1);
}

console.log("\nPack verification passed.");
