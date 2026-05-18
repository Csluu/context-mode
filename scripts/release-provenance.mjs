#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultReleaseArtifacts } from "./release-checksums.mjs";

export function getDefaultProvenanceArtifacts(root = process.cwd()) {
  return [
    ...getDefaultReleaseArtifacts(root),
    "build/SHA256SUMS",
  ];
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readPackageMetadata(root) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const repository = typeof pkg.repository === "string"
      ? pkg.repository
      : typeof pkg.repository?.url === "string"
        ? pkg.repository.url
        : null;
    return {
      name: typeof pkg.name === "string" ? pkg.name : null,
      version: typeof pkg.version === "string" ? pkg.version : null,
      license: typeof pkg.license === "string" ? pkg.license : null,
      repository,
    };
  } catch {
    return { name: null, version: null, license: null, repository: null };
  }
}

function collectGitMetadata(root) {
  const statusText = runGit(root, ["status", "--porcelain=v1"]) ?? "";
  const dirtyFiles = statusText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/\\/g, "/"));
  return {
    root: runGit(root, ["rev-parse", "--show-toplevel"]),
    commit: runGit(root, ["rev-parse", "HEAD"]),
    branch: runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    remote: runGit(root, ["remote", "get-url", "origin"]),
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
  };
}

function collectArtifacts(root, artifacts) {
  const present = [];
  const missing = [];
  for (const artifact of artifacts) {
    const filePath = resolve(root, artifact);
    if (!existsSync(filePath)) {
      missing.push(artifact);
      continue;
    }
    present.push({
      name: artifact.replace(/\\/g, "/"),
      digest: { sha256: sha256(filePath) },
      sizeBytes: statSync(filePath).size,
    });
  }
  return { present, missing };
}

function packageLockMaterial(root) {
  const lockPath = resolve(root, "package-lock.json");
  if (!existsSync(lockPath)) return null;
  return {
    uri: "package-lock.json",
    digest: { sha256: sha256(lockPath) },
  };
}

export function buildReleaseProvenance(root = process.cwd(), opts = {}) {
  const artifacts = opts.artifacts ?? getDefaultProvenanceArtifacts(root);
  const collected = collectArtifacts(root, artifacts);
  if (!opts.allowMissing && collected.missing.length > 0) {
    throw new Error(`missing release artifacts: ${collected.missing.join(", ")}`);
  }

  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const git = collectGitMetadata(root);
  if (!opts.allowNoGit && !git.commit) {
    throw new Error("git commit unavailable; rerun from a git checkout or pass --allow-no-git for local diagnostics");
  }
  if (!opts.allowDirty && git.dirty) {
    throw new Error(`git worktree is dirty; commit/stash changes or pass --allow-dirty for local diagnostics`);
  }
  const pkg = readPackageMetadata(root);
  const materials = [];
  const packageLock = packageLockMaterial(root);
  if (packageLock) materials.push(packageLock);
  if (git.commit) {
    materials.push({
      uri: git.remote ?? "git+local",
      digest: { gitCommit: git.commit },
    });
  }

  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: collected.present.map((artifact) => ({
      name: artifact.name,
      digest: artifact.digest,
    })),
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://context-mode.local/build/release-provenance/v1",
        externalParameters: {
          package: pkg,
          requestedArtifacts: artifacts.map((artifact) => artifact.replace(/\\/g, "/")),
        },
        internalParameters: {
          allowMissingArtifacts: Boolean(opts.allowMissing),
        },
        resolvedDependencies: materials,
      },
      runDetails: {
        builder: {
          id: "context-mode:scripts/release-provenance.mjs",
          version: process.version,
        },
        metadata: {
          invocationId: opts.invocationId ?? `local-${process.pid}`,
          startedOn: generatedAt,
          finishedOn: generatedAt,
        },
        byproducts: [
          {
            name: "git-state",
            content: {
              branch: git.branch,
              commit: git.commit,
              remote: git.remote,
              dirty: git.dirty,
              dirtyFiles: git.dirtyFiles,
            },
          },
          {
            name: "builder-runtime",
            content: {
              node: process.version,
              platform: process.platform,
              arch: process.arch,
              ci: process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true",
            },
          },
          {
            name: "artifact-details",
            content: {
              artifacts: collected.present,
              missingArtifacts: collected.missing,
            },
          },
        ],
      },
    },
  };
}

export function writeReleaseProvenance(root = process.cwd(), opts = {}) {
  const outDir = resolve(root, opts.outDir ?? "build");
  mkdirSync(outDir, { recursive: true });
  const statement = buildReleaseProvenance(root, opts);
  const outPath = join(outDir, "release-provenance.intoto.json");
  writeFileSync(outPath, `${JSON.stringify(statement, null, 2)}\n`, "utf8");
  let signed = false;
  if (opts.sign || process.env.CONTEXT_MODE_SIGN_RELEASE === "1") {
    const signer = opts.execFileSync ?? execFileSync;
    signer("gpg", ["--batch", "--yes", "--armor", "--detach-sign", outPath], { stdio: "inherit" });
    signed = true;
  }
  return {
    outPath,
    signed,
    subjectCount: statement.subject.length,
    dirty: statement.predicate.runDetails.byproducts[0].content.dirty,
  };
}

function parseArgs(argv) {
  const opts = {};
  const artifacts = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") opts.outDir = argv[++i];
    else if (argv[i] === "--allow-missing") opts.allowMissing = true;
    else if (argv[i] === "--allow-dirty") opts.allowDirty = true;
    else if (argv[i] === "--allow-no-git") opts.allowNoGit = true;
    else if (argv[i] === "--sign") opts.sign = true;
    else if (argv[i] === "--artifact") artifacts.push(argv[++i]);
  }
  if (artifacts.length > 0) opts.artifacts = artifacts;
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = writeReleaseProvenance(process.cwd(), parseArgs(process.argv.slice(2)));
    console.log(`release-provenance OK: ${result.subjectCount} subject(s) -> ${basename(result.outPath)}`);
    if (result.signed) console.log("release-provenance signed");
    if (result.dirty) console.log("release-provenance warning: git worktree is dirty");
  } catch (err) {
    console.error(`release-provenance failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
