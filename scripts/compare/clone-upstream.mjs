#!/usr/bin/env node
// Sibling-checkout helper: clones mksglu/context-mode at a pinned SHA into
// .compare/upstream/ and builds it. Idempotent — skips work if SHA matches.
//
// CI must not float on upstream/main. The default pin is committed in
// scripts/compare/upstream-pin.json. Override locally with .compare/UPSTREAM_SHA
// or CONTEXT_MODE_COMPARE_UPSTREAM_SHA. Floating upstream/main is allowed only
// when CONTEXT_MODE_COMPARE_ALLOW_FLOATING_UPSTREAM=1 is set explicitly.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const compareDir = join(repoRoot, ".compare");
const upstreamDir = join(compareDir, "upstream");
const shaFile = join(compareDir, "UPSTREAM_SHA");
const committedPinFile = join(__dirname, "upstream-pin.json");
const upstreamRepo = "https://github.com/mksglu/context-mode.git";
const FULL_SHA_RE = /^[a-f0-9]{40}$/i;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
  }
}

function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stderr}`);
  }
  return r.stdout.trim();
}

function currentSha(dir) {
  try { return capture("git", ["rev-parse", "HEAD"], { cwd: dir }); }
  catch { return null; }
}

function readPinnedSha() {
  const envSha = process.env.CONTEXT_MODE_COMPARE_UPSTREAM_SHA?.trim();
  if (envSha) return normalizePinnedSha(envSha.split(/\s+/)[0] || null, "CONTEXT_MODE_COMPARE_UPSTREAM_SHA");
  if (!existsSync(shaFile)) return null;
  const txt = readFileSync(shaFile, "utf8").trim();
  return normalizePinnedSha(txt.split(/\s+/)[0] || null, shaFile);
}

function readCommittedPin() {
  try {
    const parsed = JSON.parse(readFileSync(committedPinFile, "utf8"));
    const sha = typeof parsed?.sha === "string" ? parsed.sha.trim() : "";
    return normalizePinnedSha(sha || null, committedPinFile);
  } catch {
    return null;
  }
}

function normalizePinnedSha(value, source) {
  if (!value) return null;
  if (FULL_SHA_RE.test(value)) return value.toLowerCase();
  throw new Error(
    `Invalid upstream pin in ${source}: expected a full 40-character commit SHA, got "${value}". ` +
      "Use CONTEXT_MODE_COMPARE_ALLOW_FLOATING_UPSTREAM=1 only for local re-pin runs.",
  );
}

function writePinnedSha(sha, tag) {
  mkdirSync(compareDir, { recursive: true });
  writeFileSync(shaFile, `${sha}  ${tag || ""}\n`, "utf8");
}

function main() {
  mkdirSync(compareDir, { recursive: true });

  let pinned = readPinnedSha() ?? readCommittedPin();
  const cloneExists = existsSync(join(upstreamDir, ".git"));

  if (cloneExists && pinned && currentSha(upstreamDir) === pinned) {
    console.log(`[compare] upstream already at pinned SHA ${pinned.slice(0, 10)}, skipping clone.`);
  } else {
    if (cloneExists) {
      console.log(`[compare] removing stale upstream clone at ${upstreamDir}`);
      rmSync(upstreamDir, { recursive: true, force: true });
    }
    console.log(`[compare] cloning ${upstreamRepo} -> ${upstreamDir}`);
    run("git", ["clone", "--filter=blob:none", upstreamRepo, upstreamDir]);

    if (!pinned) {
      if (process.env.CONTEXT_MODE_COMPARE_ALLOW_FLOATING_UPSTREAM !== "1") {
        throw new Error(
          "No upstream SHA pin found. Add scripts/compare/upstream-pin.json, " +
            "set CONTEXT_MODE_COMPARE_UPSTREAM_SHA, or set " +
            "CONTEXT_MODE_COMPARE_ALLOW_FLOATING_UPSTREAM=1 for a local re-pin run.",
        );
      }
      const head = currentSha(upstreamDir);
      let tag = "";
      try { tag = capture("git", ["describe", "--tags", "--abbrev=0"], { cwd: upstreamDir }); } catch {}
      writePinnedSha(head, tag);
      pinned = head;
      console.log(`[compare] pinned upstream to ${head.slice(0, 10)} (${tag || "no tag"})`);
    } else {
      console.log(`[compare] checking out pinned SHA ${pinned.slice(0, 10)}`);
      run("git", ["checkout", "-q", pinned], { cwd: upstreamDir });
    }
  }

  const buildMarker = join(upstreamDir, "server.bundle.mjs");
  if (existsSync(buildMarker)) {
    console.log(`[compare] upstream already built (server.bundle.mjs present), skipping build.`);
    return;
  }

  console.log(`[compare] npm install in upstream`);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: upstreamDir });
  console.log(`[compare] npm run build in upstream`);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: upstreamDir });
  console.log(`[compare] upstream ready at ${upstreamDir}`);
}

try { main(); }
catch (e) { console.error(`[compare] FAILED: ${e.message}`); process.exit(1); }
