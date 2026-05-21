// Reads the latest competitor-baseline-*.json and emits an analytical report:
//   - executive table: total bytes per tool per workflow + saved % vs raw
//   - per-workflow drill-down: per-step bytes for each tool
//   - dedup analysis: pass-by-pass bytes (workflow B) — does the tool plateau?
//   - cascade plot: cumulative bytes after each turn (workflow C)
//   - adapter availability roster
//
// Both .md and .json artifacts are written to build/compare/.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FORK_ONLY_WORKFLOWS } from "./workflows-competitors/index.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BUILD_DIR = resolve(REPO_ROOT, "build", "compare");

interface RunResult {
  tool: string;
  stepLabel: string;
  ms: number;
  bytes: number;
  tokens: number;
  ok: boolean;
  errorReason?: string;
  fallbackUsed?: boolean;
  oracleOk?: boolean;
  oracleIssues?: string[];
}

interface WorkflowResult {
  tool: string;
  workflow: string;
  totalBytes: number;
  totalTokens: number;
  totalMs: number;
  steps: RunResult[];
  available: boolean;
  skipReason?: string;
}

interface BaselineFile {
  meta: {
    generatedAt: string;
    platform: string;
    nodeVersion: string;
    cwd: string;
    samples?: number;
    adapters: Array<{ id: string; available: boolean; version?: string; reason?: string; installSizeBytes?: number }>;
  };
  rows: WorkflowResult[];
}

function latestBaselineFile(): string {
  mkdirSync(BUILD_DIR, { recursive: true });
  const files = readdirSync(BUILD_DIR)
    .filter((f) => f.startsWith("competitor-baseline-") && f.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error("no competitor-baseline-*.json found. Run compare:competitors:run first.");
  return join(BUILD_DIR, files[files.length - 1]);
}

function fmt(n: number): string {
  if (n === 0) return "0";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function pct(saved: number, baseline: number): string {
  if (baseline === 0) return "—";
  return `${((1 - saved / baseline) * 100).toFixed(1)}%`;
}

// Sonnet 4.6 input pricing: $3 per million tokens (≈ 4M bytes UTF-8 avg).
// We bench TOOL OUTPUT bytes which become INPUT TOKENS in the next API call.
const SONNET_INPUT_USD_PER_MTOK = 3.0;
const CHARS_PER_TOKEN = 4;

function bytesToUsd(bytes: number): number {
  const tokens = bytes / CHARS_PER_TOKEN;
  return (tokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK;
}

function fmtUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.001) return `$${(usd * 1000).toFixed(2)}m`; // millicents
  if (usd < 1) return `$${(usd * 100).toFixed(2)}¢`;
  return `$${usd.toFixed(2)}`;
}

function tableRow(cells: readonly string[]): string {
  return "| " + cells.join(" | ") + " |";
}

function buildExecutive(rows: WorkflowResult[], workflows: string[], tools: string[]): string {
  const lines: string[] = [];
  lines.push("## Executive — total bytes per tool per workflow");
  lines.push("");
  lines.push("Workflows tagged 🔒 are **fork-only territory** — competitors don't claim to do them. Their column reflects fallback-to-raw, not a real comparison.");
  lines.push("");
  const head = ["Workflow", ...tools];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  for (const wf of workflows) {
    const forkOnly = FORK_ONLY_WORKFLOWS.has(wf);
    const cells = [forkOnly ? `🔒 ${wf}` : wf];
    const rawRow = rows.find((r) => r.workflow === wf && r.tool === "raw");
    const rawBytes = rawRow?.totalBytes ?? 0;
    for (const tool of tools) {
      const r = rows.find((row) => row.workflow === wf && row.tool === tool);
      if (!r) { cells.push("N/A"); continue; }
      if (tool === "raw") { cells.push(fmt(r.totalBytes)); continue; }
      cells.push(`${fmt(r.totalBytes)} (${pct(r.totalBytes, rawBytes)})`);
    }
    lines.push(tableRow(cells));
  }
  lines.push("");
  return lines.join("\n");
}

function buildForkOnlySection(rows: WorkflowResult[]): string {
  const lines = ["## 🔒 Fork-only territory", ""];
  lines.push("These workflows test capabilities **only fork has**. Other tools' rows reflect raw-fallback bytes, not their own compression. Read as: 'fork's value where nobody else competes.'");
  lines.push("");
  lines.push(tableRow(["Workflow", "Why fork-only", "Fork bytes", "Raw bytes", "Saved"]));
  lines.push(tableRow(["---", "---", "---", "---", "---"]));
  const reasons: Record<string, string> = {
    "web-fetch-suite": "Only fork's ctx_fetch_and_index compresses URLs",
    "search-corpus": "Only fork ctx_search + ctx_index do FTS5 over indexed corpora",
    "sidecar-replay": "Only fork stores raw output as sidecar for later replay",
    "restart-cache-test": "Only fork + lean-ctx persist read cache across calls",
  };
  for (const wf of Array.from(FORK_ONLY_WORKFLOWS)) {
    const fork = rows.find((r) => r.workflow === wf && r.tool === "fork");
    const raw = rows.find((r) => r.workflow === wf && r.tool === "raw");
    if (!fork || !raw) continue;
    lines.push(tableRow([wf, reasons[wf] ?? "—", fmt(fork.totalBytes), fmt(raw.totalBytes), pct(fork.totalBytes, raw.totalBytes)]));
  }
  lines.push("");
  return lines.join("\n");
}

function buildDollarSummary(rows: WorkflowResult[], tools: string[]): string {
  const lines = ["## $ saved per bench run — Sonnet 4.6 input pricing", ""];
  lines.push("Bench output bytes = next API call's input tokens. At Sonnet 4.6 input pricing ($3/MTok, ~4 chars/token), every byte saved is real money saved across a session.");
  lines.push("");
  const head = ["Tool", "Total bytes", "USD if all input", "Saved vs raw"];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  const rawTotal = rows.filter((r) => r.tool === "raw").reduce((a, r) => a + r.totalBytes, 0);
  const rawUsd = bytesToUsd(rawTotal);
  for (const tool of tools) {
    const total = rows.filter((r) => r.tool === tool).reduce((a, r) => a + r.totalBytes, 0);
    const usd = bytesToUsd(total);
    const saved = tool === "raw" ? "—" : fmtUsd(rawUsd - usd);
    lines.push(tableRow([tool, fmt(total), fmtUsd(usd), saved]));
  }
  lines.push("");
  lines.push("_Single-bench numbers are tiny. Multiply by your session count + agents to project real savings. A typical heavy-Claude-Code user makes ~5000 tool calls/month; a 1MB saving per run × 5000 = 5GB ≈ $3.75 saved._");
  lines.push("");
  return lines.join("\n");
}

function buildSqzNote(): string {
  return [
    "## sqz — not benchmarked on this run",
    "",
    "sqz cannot be built or installed on Windows MSVC at this time: cargo `sqz-cli` build fails with compile errors, and the npm `sqz-cli` postinstall returns 404 for `sqz-v1.1.1-x86_64-pc-windows-msvc.zip` on GitHub releases. Tested on Windows 11 / Node 24 / Cargo 1.95.",
    "",
    "sqz's headline claim is **cross-session dedup** (13-token refs for repeated reads). Cannot validate from this harness until Windows install path works, or until the bench runs on Linux/macOS via WSL.",
    "",
  ].join("\n");
}

function buildAvailability(meta: BaselineFile["meta"]): string {
  const lines = ["## Adapters detected", "", tableRow(["Tool", "Available", "Version / Reason", "Install size"]), tableRow(["---", "---", "---", "---"])];
  for (const a of meta.adapters) {
    const size = a.installSizeBytes ? fmt(a.installSizeBytes) : "—";
    lines.push(tableRow([a.id, a.available ? "✓" : "✗", a.version ?? a.reason ?? "", size]));
  }
  lines.push("");
  if (meta.samples && meta.samples > 1) lines.push(`_Steps re-runnable across networks/disk caches were sampled N=${meta.samples}; bytes/ms reported as median._`);
  lines.push("");
  return lines.join("\n");
}

function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(p * s.length));
  return s[idx];
}

function buildLatencyProfile(rows: WorkflowResult[], tools: string[]): string {
  const lines = ["## Latency profile — p50 / p95 per tool (ms per step)", ""];
  const head = ["Tool", "Steps", "p50", "p95", "p99", "max", "total ms"];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  for (const tool of tools) {
    const allSteps: { ms: number }[] = [];
    for (const r of rows.filter((x) => x.tool === tool)) {
      for (const s of r.steps) allSteps.push({ ms: s.ms });
    }
    const ms = allSteps.map((s) => s.ms).filter((m) => m > 0);
    if (ms.length === 0) { lines.push(tableRow([tool, "0", "—", "—", "—", "—", "—"])); continue; }
    const total = ms.reduce((a, b) => a + b, 0);
    lines.push(tableRow([
      tool,
      String(ms.length),
      `${percentile(ms, 0.5)}ms`,
      `${percentile(ms, 0.95)}ms`,
      `${percentile(ms, 0.99)}ms`,
      `${Math.max(...ms)}ms`,
      `${total}ms`,
    ]));
  }
  lines.push("");
  lines.push("_MCP-stdio tools (fork, fork-intent) pay JSON-RPC overhead per call — typically 50-150ms baseline. CLI tools pay process-spawn overhead — typically 20-80ms._");
  lines.push("");
  return lines.join("\n");
}

function buildPerStep(rows: WorkflowResult[], wfName: string, tools: string[]): string {
  const rowsForWf = rows.filter((r) => r.workflow === wfName);
  if (rowsForWf.length === 0) return "";
  // Use raw as the canonical step order.
  const raw = rowsForWf.find((r) => r.tool === "raw");
  if (!raw) return `### ${wfName}\n_no raw baseline_\n`;
  const lines: string[] = [];
  lines.push(`### ${wfName}`);
  lines.push("");
  const head = ["Step", ...tools];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  for (const step of raw.steps) {
    const cells = [step.stepLabel];
    for (const tool of tools) {
      const wf = rowsForWf.find((r) => r.tool === tool);
      const s = wf?.steps.find((st) => st.stepLabel === step.stepLabel);
      if (!s) { cells.push("N/A"); continue; }
      cells.push(`${fmt(s.bytes)}${s.ok ? "" : " ✗"}`);
    }
    lines.push(tableRow(cells));
  }
  lines.push("");
  return lines.join("\n");
}

function buildDedupPlateau(rows: WorkflowResult[], tools: string[]): string {
  const wfName = "dedup-compounding";
  const rowsForWf = rows.filter((r) => r.workflow === wfName);
  if (rowsForWf.length === 0) return "";
  const raw = rowsForWf.find((r) => r.tool === "raw");
  if (!raw) return "";
  // Bucket steps by pass number (label `pass<N>-...`).
  const lines = ["## Dedup analysis — per-pass totals (5 files × 5 passes)", ""];
  const head = ["Pass", ...tools];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  for (let p = 1; p <= 5; p++) {
    const cells = [`pass ${p}`];
    for (const tool of tools) {
      const wf = rowsForWf.find((r) => r.tool === tool);
      if (!wf) { cells.push("N/A"); continue; }
      const sum = wf.steps
        .filter((s) => s.stepLabel.startsWith(`pass${p}-`))
        .reduce((acc, s) => acc + s.bytes, 0);
      cells.push(fmt(sum));
    }
    lines.push(tableRow(cells));
  }
  lines.push("");
  lines.push("_Tools that dedup should show pass 2-5 drop sharply vs pass 1._");
  lines.push("");
  return lines.join("\n");
}

function buildCascadePlot(rows: WorkflowResult[], tools: string[]): string {
  const wfName = "cascade-50turn";
  const rowsForWf = rows.filter((r) => r.workflow === wfName);
  if (rowsForWf.length === 0) return "";
  const raw = rowsForWf.find((r) => r.tool === "raw");
  if (!raw) return "";
  const lines = ["## Cascade — cumulative bytes after every 10 turns", ""];
  const head = ["After turn", ...tools];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  // Build cumulative arrays per tool.
  const cumulative = new Map<string, number[]>();
  for (const tool of tools) {
    const wf = rowsForWf.find((r) => r.tool === tool);
    const arr: number[] = [];
    let acc = 0;
    for (const s of (wf?.steps ?? [])) {
      acc += s.bytes;
      arr.push(acc);
    }
    cumulative.set(tool, arr);
  }
  for (const t of [10, 20, 30, 40, 50]) {
    const cells = [`turn ${t}`];
    for (const tool of tools) {
      const arr = cumulative.get(tool) ?? [];
      const val = arr[t - 1];
      cells.push(val === undefined ? "N/A" : fmt(val));
    }
    lines.push(tableRow(cells));
  }
  lines.push("");
  return lines.join("\n");
}

function buildOracleSummary(rows: WorkflowResult[], tools: string[]): string {
  const lines = ["## Quality oracle — pass / total per tool per workflow", ""];
  const head = ["Workflow", ...tools];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  const workflows = Array.from(new Set(rows.map((r) => r.workflow)));
  for (const wf of workflows) {
    const cells = [wf];
    for (const tool of tools) {
      const r = rows.find((row) => row.workflow === wf && row.tool === tool);
      if (!r) { cells.push("N/A"); continue; }
      const withOracle = r.steps.filter((s) => s.oracleOk !== undefined);
      if (withOracle.length === 0) { cells.push("—"); continue; }
      const passed = withOracle.filter((s) => s.oracleOk).length;
      const flag = passed < withOracle.length ? " ⚠" : "";
      cells.push(`${passed}/${withOracle.length}${flag}`);
    }
    lines.push(tableRow(cells));
  }
  lines.push("");
  return lines.join("\n");
}

function buildFallbackSummary(rows: WorkflowResult[], tools: string[]): string {
  const lines = ["## Fallback usage — steps where adapter failed and runner retried via raw", ""];
  const head = ["Workflow", ...tools.filter((t) => t !== "raw")];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  const workflows = Array.from(new Set(rows.map((r) => r.workflow)));
  for (const wf of workflows) {
    const cells = [wf];
    for (const tool of head.slice(1)) {
      const r = rows.find((row) => row.workflow === wf && row.tool === tool);
      if (!r) { cells.push("N/A"); continue; }
      const fb = r.steps.filter((s) => s.fallbackUsed).length;
      cells.push(fb === 0 ? "—" : `${fb}/${r.steps.length}`);
    }
    lines.push(tableRow(cells));
  }
  lines.push("");
  lines.push("_When raw fallback fires, the tool's bytes for that step reflect the raw payload, not the tool's compression. Higher fallback count = tool lacks coverage._");
  lines.push("");
  return lines.join("\n");
}

function buildVerdict(rows: WorkflowResult[], tools: string[]): string {
  const lines = ["## Verdict — saved % vs raw, per workflow", ""];
  const head = ["Workflow", ...tools.filter((t) => t !== "raw")];
  lines.push(tableRow(head));
  lines.push(tableRow(head.map(() => "---")));
  const workflows = Array.from(new Set(rows.map((r) => r.workflow)));
  for (const wf of workflows) {
    const rawRow = rows.find((r) => r.tool === "raw" && r.workflow === wf);
    const raw = rawRow?.totalBytes ?? 0;
    const cells = [wf];
    for (const tool of head.slice(1)) {
      const r = rows.find((row) => row.workflow === wf && row.tool === tool);
      if (!r) { cells.push("N/A"); continue; }
      if (raw === 0) { cells.push("—"); continue; }
      const savedPct = ((1 - r.totalBytes / raw) * 100).toFixed(1);
      cells.push(`${savedPct}%`);
    }
    lines.push(tableRow(cells));
  }
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const file = latestBaselineFile();
  const data = JSON.parse(readFileSync(file, "utf8")) as BaselineFile;
  const tools = Array.from(new Set(data.rows.map((r) => r.tool)));
  // Pin raw first, then fork, then others in adapter declaration order.
  const order = [
    "raw",
    "naive-truncate",
    "fork",
    "fork-intent",
    "upstream",
    "lean-ctx",
    "lean-ctx-aggressive",
    "context-compress",
    "context-compress-aggressive",
    "squeez",
    "sqz",
    "chop",
  ];
  tools.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const workflows = Array.from(new Set(data.rows.map((r) => r.workflow)));

  const lines: string[] = [];
  lines.push("# Phase 1 — Competitor comparison report");
  lines.push("");
  lines.push(`Generated ${data.meta.generatedAt} on ${data.meta.platform} / node ${data.meta.nodeVersion}.`);
  lines.push("");
  lines.push("Tools compared as wrappers / MCP / hook-CLI: **fork (this repo)** vs **lean-ctx**, **context-compress**, **squeez**, **sqz**, **chop** — and raw shell as the baseline.");
  lines.push("");
  lines.push("**Methodology notes (read first):**");
  lines.push("- fork-intent = fork with `ctx_execute(intent:\"...\")` — fork's killer feature. Default `fork` row is opt-out behavior.");
  lines.push("- Aggressive variants of multi-mode tools run alongside their defaults.");
  lines.push("- Hook-vs-CLI: chop/squeez/sqz are primarily PreToolUse hooks. We test their `wrap` CLI subcommand which calls the same compression engine — bytes saved are equivalent; only UX (auto-intercept vs opt-in) differs.");
  lines.push("- Latency includes process-spawn (CLI tools) or stdio JSON-RPC (MCP tools). Apples-to-apples on bytes, not on milliseconds.");
  lines.push("- N-sample median used for steady-state steps (commands/reads/searches). Network fetches and indexing run N=1 because jitter dominates.");
  lines.push("");
  lines.push(buildAvailability(data.meta));
  lines.push(buildSqzNote());
  lines.push(buildExecutive(data.rows, workflows, tools));
  lines.push(buildForkOnlySection(data.rows));
  lines.push(buildVerdict(data.rows, tools));
  lines.push(buildDollarSummary(data.rows, tools));
  lines.push(buildLatencyProfile(data.rows, tools));
  lines.push(buildOracleSummary(data.rows, tools));
  lines.push(buildFallbackSummary(data.rows, tools));
  lines.push(buildDedupPlateau(data.rows, tools));
  lines.push(buildCascadePlot(data.rows, tools));
  lines.push("## Per-step bytes");
  lines.push("");
  for (const wf of workflows) {
    lines.push(buildPerStep(data.rows, wf, tools));
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outMd = join(BUILD_DIR, `competitor-report-${ts}.md`);
  const outJson = join(BUILD_DIR, `competitor-report-${ts}.json`);
  writeFileSync(outMd, lines.join("\n"));
  writeFileSync(outJson, JSON.stringify({ source: file, generatedAt: new Date().toISOString(), tools, workflows, data }, null, 2));
  console.log(`[competitor-report] wrote ${outMd}`);
  console.log(`[competitor-report] wrote ${outJson}`);
}

main();
