#!/usr/bin/env node
/**
 * assert-bundle.mjs — Sanity-check that bundled output files exist, are
 * non-empty, parse as valid ES modules, and don't contain placeholder
 * sentinels left over from a failed build.
 *
 * Invoked by `npm run build` after esbuild emits the bundles. Failure here
 * stops a release before broken artifacts ship.
 *
 * Usage: node scripts/assert-bundle.mjs <bundle1> <bundle2> ...
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("assert-bundle: no bundle paths provided");
  process.exit(2);
}

// repoRoot = parent of /scripts (where this file lives). fileURLToPath handles
// Windows drive letters; new URL().pathname does not.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Sentinel strings that indicate an incomplete or buggy build.
const FORBIDDEN_SUBSTRINGS = [
  // esbuild leaves these when an external import fails to resolve at runtime
  "throw new Error(\"Dynamic require",
  // unresolved env-var placeholder esbuild emits with --define when given a bad value
  "process.env.__UNDEFINED__",
];

// Minimum size sanity threshold — any bundle smaller than this almost
// certainly indicates a truncated emit. Keep generous so a deliberately
// tiny adapter bundle doesn't trip the check.
const MIN_BYTES = 1024;

let failed = 0;
for (const rel of args) {
  const abs = resolve(repoRoot, rel);
  if (!existsSync(abs)) {
    console.error(`[FAIL] missing: ${rel}`);
    failed++;
    continue;
  }
  const stats = statSync(abs);
  if (stats.size < MIN_BYTES) {
    console.error(`[FAIL] too small (${stats.size} bytes): ${rel}`);
    failed++;
    continue;
  }
  const src = readFileSync(abs, "utf8");
  // Bundles should start with shebang or be valid ESM (import / export / "use ...").
  // esbuild's ESM output may start with `#!/usr/bin/env node` for cli bundles or
  // jump straight into `import` statements / minified `var ...`.
  const head = src.slice(0, 200);
  const looksValid =
    head.startsWith("#!") ||
    /^\s*(import|export|var|const|let|function|"use strict"|\(|\/\*|\/\/)/m.test(head);
  if (!looksValid) {
    console.error(`[FAIL] unexpected bundle prefix: ${rel}`);
    console.error(`       head: ${JSON.stringify(head.slice(0, 80))}`);
    failed++;
    continue;
  }
  for (const sentinel of FORBIDDEN_SUBSTRINGS) {
    if (src.includes(sentinel)) {
      console.error(`[FAIL] forbidden substring ${JSON.stringify(sentinel)} in ${rel}`);
      failed++;
      break;
    }
  }
  console.log(`[OK]   ${rel}  (${(stats.size / 1024).toFixed(1)} KB)`);
}

if (failed > 0) {
  console.error(`\nassert-bundle: ${failed} failure(s)`);
  process.exit(1);
}
console.log(`\nassert-bundle: all ${args.length} bundles OK`);
