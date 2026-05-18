#!/usr/bin/env node
/**
 * assert-asymmetric-drift.mjs — Sanity-check that source and bundled
 * outputs have not drifted apart.
 *
 * "Asymmetric drift" = the case where someone edits src/*.ts but forgets
 * to rebuild, leaving server.bundle.mjs stale. This script catches it by
 * comparing the source mtime against the bundle mtime. If any source file
 * under src/ is newer than the corresponding bundle output, fail.
 *
 * Invoked by `npm run build` after assert-bundle. Failure stops a release
 * before the published package ships out-of-sync code.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Each pair: (source globs) → (bundle file). When any matching source file
// is newer than the bundle, fail.
const BUNDLES = [
  { src: ["src"], bundle: "server.bundle.mjs" },
  { src: ["src"], bundle: "cli.bundle.mjs" },
  { src: ["src/session"], bundle: "hooks/session-extract.bundle.mjs" },
  { src: ["src/session"], bundle: "hooks/session-snapshot.bundle.mjs" },
  { src: ["src/session"], bundle: "hooks/session-db.bundle.mjs" },
  { src: ["src"], bundle: "hooks/security.bundle.mjs", excludeDirs: new Set(["adapters", "session"]) },
  { src: ["src/routing"], bundle: "hooks/rewrite-registry.bundle.mjs" },
];

function walkTs(dir, excludeDirs = new Set(), out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      walkTs(join(dir, entry.name), excludeDirs, out);
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

let failed = 0;
for (const { src, bundle, excludeDirs } of BUNDLES) {
  const bundlePath = resolve(repoRoot, bundle);
  if (!existsSync(bundlePath)) {
    console.error(`[FAIL] bundle missing: ${bundle}`);
    failed++;
    continue;
  }
  const bundleMtime = statSync(bundlePath).mtimeMs;

  let newest = 0;
  let newestFile = "";
  for (const srcDir of src) {
    const files = walkTs(resolve(repoRoot, srcDir), excludeDirs);
    for (const f of files) {
      const m = statSync(f).mtimeMs;
      if (m > newest) { newest = m; newestFile = f; }
    }
  }

  if (newest > bundleMtime) {
    const driftSec = ((newest - bundleMtime) / 1000).toFixed(1);
    console.error(
      `[FAIL] ${bundle} is ${driftSec}s older than newest source ${newestFile.replace(repoRoot, "")}`,
    );
    failed++;
  } else {
    console.log(`[OK]   ${bundle}  (newest source ${newestFile.replace(repoRoot, "").replace(/\\/g, "/")})`);
  }
}

if (failed > 0) {
  console.error(`\nassert-asymmetric-drift: ${failed} stale bundle(s) — rebuild required.`);
  process.exit(1);
}
console.log("\nassert-asymmetric-drift: all bundles fresh");
