#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_PACKAGE_FILE_PATTERNS = [
  /^build\/SHA256SUMS(?:\.|$)/,
  /^build\/release-(?:provenance|sbom)\./,
  /^build\/(?:benchmark-report|adapter-validation-report|schema-snapshot|fixture-coverage|eval-(?:fast|full)-report|guard-fixtures-report|semantic-diff-fixture-report|task-cache-readiness-report)\.json$/,
  /^build\/release-checklist\.md$/,
];

function readPackage(root) {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
}

export function npmTarballName(pkg) {
  const name = String(pkg.name ?? "package")
    .replace(/^@/, "")
    .replace(/\//g, "-");
  return `${name}-${pkg.version}.tgz`;
}

export function defaultReleasePackagePath(root = process.cwd()) {
  const pkg = readPackage(root);
  return join("release-artifacts", npmTarballName(pkg));
}

export function forbiddenPackageFiles(files = []) {
  return files
    .map((file) => String(file.path ?? file).replace(/\\/g, "/"))
    .filter((file) => FORBIDDEN_PACKAGE_FILE_PATTERNS.some((pattern) => pattern.test(file)))
    .sort();
}

export function writeReleasePackage(root = process.cwd(), opts = {}) {
  const outDir = resolve(root, opts.outDir ?? "release-artifacts");
  mkdirSync(outDir, { recursive: true });
  const npmArgs = ["pack", "--pack-destination", outDir, "--json"];
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath && existsSync(npmExecPath)
    ? process.execPath
    : process.platform === "win32"
      ? "cmd.exe"
      : "npm";
  const args = npmExecPath && existsSync(npmExecPath)
    ? [npmExecPath, ...npmArgs]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd", ...npmArgs]
      : npmArgs;
  const runner = opts.execFileSync ?? execFileSync;
  const raw = runner(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const packed = JSON.parse(String(raw));
  const first = Array.isArray(packed) ? packed[0] : packed;
  const forbidden = forbiddenPackageFiles(first?.files ?? []);
  if (forbidden.length > 0) {
    throw new Error(`npm package includes release metadata that must stay outside the tarball: ${forbidden.join(", ")}`);
  }
  const filename = first?.filename ?? npmTarballName(readPackage(root));
  const tarballPath = resolve(outDir, filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack did not create expected tarball: ${tarballPath}`);
  }
  return {
    tarballPath,
    filename,
    size: first?.size,
    unpackedSize: first?.unpackedSize,
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") opts.outDir = argv[++i];
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = writeReleasePackage(process.cwd(), parseArgs(process.argv.slice(2)));
    console.log(`release-package OK: ${basename(result.tarballPath)}`);
  } catch (err) {
    console.error(`release-package failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
