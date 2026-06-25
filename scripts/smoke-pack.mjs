// Clean-install smoke test: pack @h402/core and @h402/cli, install BOTH tarballs
// into a throwaway project (the documented publish order — core before cli, since
// cli depends on @h402/core), and run the installed `h402 --help`.
//
// `verify-pack.mjs` checks tarball *contents*; this checks that the packed
// artifacts actually install and execute from outside the workspace — catching
// breakage the in-repo build hides (an unresolvable @h402/core, a bad bin
// shebang/entrypoint), which is exactly the documented global-install path. It
// runs only `h402 --help`, so it does not exercise OWS-binary resolution.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const work = mkdtempSync(join(tmpdir(), "h402-smoke-"));

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" });
}

try {
  // Pack each package (prepack builds dist) into the temp dir, in publish order.
  const tarballs = ["@h402/core", "@h402/cli"].map((pkg) => {
    const out = run("npm", ["pack", "--workspace", pkg, "--pack-destination", work, "--json"], root);
    const filename = JSON.parse(out)[0].filename;
    console.log(`✓ packed ${pkg} -> ${filename}`);
    return join(work, filename);
  });

  // Install both tarballs into a clean project: cli's `@h402/core` dependency must
  // resolve from the core tarball, not the workspace symlink or the registry.
  const project = join(work, "project");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "h402-smoke", version: "1.0.0", private: true }, null, 2));
  run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], project);

  // The documented entrypoint must run from a clean install.
  const bin = join(project, "node_modules", ".bin", "h402");
  const help = run(bin, ["--help"], project);
  if (!help.includes("h402")) {
    throw new Error(`'h402 --help' ran but did not print expected usage:\n${help}`);
  }
  console.log("✓ smoke: `h402 --help` runs from a clean tarball install");
  console.log("\nPack install smoke test passed.");
} catch (error) {
  console.error(`\nPack install smoke test FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
