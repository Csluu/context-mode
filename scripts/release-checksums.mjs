#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultReleasePackagePath } from "./release-package.mjs";

export const DEFAULT_RELEASE_ARTIFACTS = [
  "server.bundle.mjs",
  "cli.bundle.mjs",
  "hooks/session-extract.bundle.mjs",
  "hooks/session-snapshot.bundle.mjs",
  "hooks/session-db.bundle.mjs",
  "hooks/security.bundle.mjs",
  "hooks/rewrite-registry.bundle.mjs",
  "build/benchmark-report.json",
  "build/adapter-validation-report.json",
  "build/schema-snapshot.json",
  "build/fixture-coverage.json",
  "build/eval-full-report.json",
  "build/guard-fixtures-report.json",
  "build/semantic-diff-fixture-report.json",
  "build/task-cache-readiness-report.json",
  "build/release-checklist.md",
  "build/release-sbom.json",
];

export function getDefaultReleaseArtifacts(root = process.cwd()) {
  return [
    ...DEFAULT_RELEASE_ARTIFACTS,
    defaultReleasePackagePath(root),
  ];
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function generateChecksumManifest(root = process.cwd(), opts = {}) {
  const artifacts = opts.artifacts ?? getDefaultReleaseArtifacts(root);
  const present = artifacts
    .map((artifact) => ({ artifact, path: resolve(root, artifact) }))
    .filter((item) => existsSync(item.path));
  const missing = artifacts.filter((artifact) => !existsSync(resolve(root, artifact)));
  const lines = present
    .map((item) => `${sha256(item.path)}  ${item.artifact.replace(/\\/g, "/")}`)
    .sort();
  return {
    ok: present.length > 0 && (opts.allowMissing ? true : missing.length === 0),
    lines,
    present: present.map((item) => item.artifact),
    missing,
  };
}

export function writeReleaseChecksums(root = process.cwd(), opts = {}) {
  const outDir = resolve(root, opts.outDir ?? "build");
  mkdirSync(outDir, { recursive: true });
  const manifest = generateChecksumManifest(root, {
    artifacts: opts.artifacts,
    allowMissing: opts.allowMissing,
  });
  if (!manifest.ok) {
    throw new Error(`missing release artifacts: ${manifest.missing.join(", ")}`);
  }
  const manifestPath = join(outDir, "SHA256SUMS");
  writeFileSync(manifestPath, `${manifest.lines.join("\n")}\n`, "utf8");

  let signed = false;
  let signingNote = "";
  if (opts.sign || process.env.CONTEXT_MODE_SIGN_RELEASE === "1") {
    const signer = opts.execFileSync ?? execFileSync;
    signer("gpg", ["--batch", "--yes", "--armor", "--detach-sign", manifestPath], { stdio: "inherit" });
    signed = true;
  } else {
    signingNote = "Release checksums are unsigned because CONTEXT_MODE_SIGN_RELEASE=1 was not set in this environment.";
    writeFileSync(join(outDir, "SHA256SUMS.signing-note.txt"), `${signingNote}\n`, "utf8");
  }

  return {
    manifestPath,
    signed,
    signingNote,
    artifactCount: manifest.present.length,
    missing: manifest.missing,
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") opts.outDir = argv[++i];
    else if (argv[i] === "--allow-missing") opts.allowMissing = true;
    else if (argv[i] === "--sign") opts.sign = true;
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = writeReleaseChecksums(process.cwd(), parseArgs(process.argv.slice(2)));
    console.log(`release-checksums OK: ${result.artifactCount} artifact(s) -> ${basename(result.manifestPath)}`);
    if (!result.signed) console.log(result.signingNote);
  } catch (err) {
    console.error(`release-checksums failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
