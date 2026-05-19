// Shared helpers for fork-vs-upstream comparison harnesses.
// Each tool harness imports from here so iteration logic, canonicalization,
// parity grading, and reporting stay consistent.
//
// Per-iteration model:
//   - Each scenario runs N iterations (default 5) plus 1 throwaway warmup.
//   - Iterations are interleaved per side (fork.iter[i] then upstream.iter[i])
//     so system-load drift hits both sides symmetrically.
//   - Fork and upstream each get their own isolated CONTEXT_MODE_HOME — state
//     written by one side never leaks into the other.
//   - Reported ms/bytes: median + p95 over the N iterations.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpStdioClient, type ToolCallResult } from "./runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, "..", "..");
export const forkServer = join(repoRoot, "server.bundle.mjs");
export const upstreamServer = join(repoRoot, ".compare", "upstream", "server.bundle.mjs");
export const reportDir = join(repoRoot, "build", "compare");

export const DEFAULT_ITERATIONS = 5;
export const DEFAULT_WARMUPS = 1;
export const DIVERGENCE_PREVIEW_LINES = 5;

export interface Scenario {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  /** Per-scenario canonicalizer override applied after the default. */
  canonicalize?: (text: string) => string;
  /** Setup that runs on each client before iterations. */
  setup?: (client: McpStdioClient) => Promise<void>;
  /** Override default iteration count for this scenario. */
  iterations?: number;
  /** Override default warmup count for this scenario. */
  warmups?: number;
  /** Correctness oracle. Return [] if OK, else list of issue strings.
   *  Receives the canonicalized text of the LAST measured iteration. */
  assert?: (text: string) => string[];
}

export interface IterStats {
  median: number;
  p95: number;
  min: number;
  max: number;
  values: number[];
}

export interface SideMetric {
  ok: boolean;
  err?: string;
  attempts: number;
  successes: number;
  failures: number;
  ms: IterStats;
  bytes: IterStats;
}

export interface Row {
  scenario: string;
  tool: string;
  iterations: number;
  fork: SideMetric;
  upstream: SideMetric;
  parity: "match" | "equivalent" | "divergent" | "error";
  assertIssues: string[];
  diffPreview: string;
  notes: string;
}

export function requireToolOk(result: ToolCallResult, context: string): ToolCallResult {
  if (result.isError) {
    throw new Error(`${context}: ${result.errorText || "tool returned isError: true"}`);
  }
  return result;
}

function emptyStats(): IterStats { return { median: 0, p95: 0, min: 0, max: 0, values: [] }; }
function emptySide(): SideMetric {
  return { ok: false, attempts: 0, successes: 0, failures: 0, ms: emptyStats(), bytes: emptyStats() };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function summarize(values: number[]): IterStats {
  if (values.length === 0) return emptyStats();
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    values: sorted,
  };
}

export function preflight(opts: { upstream?: boolean } = { upstream: true }): void {
  if (!existsSync(forkServer)) {
    console.error(`[compare] fork server bundle missing: ${forkServer}`);
    console.error(`         run: npm run build`);
    process.exit(2);
  }
  if (opts.upstream !== false && !existsSync(upstreamServer)) {
    console.error(`[compare] upstream server bundle missing: ${upstreamServer}`);
    console.error(`         run: npm run compare:setup`);
    process.exit(2);
  }
}

export function extractText(result: any): string {
  const content = result?.content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  return content.map((c: any) => (typeof c?.text === "string" ? c.text : JSON.stringify(c))).join("\n");
}

const ROOT_RE = new RegExp(repoRoot.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"), "g");
const TMP_RE = new RegExp(tmpdir().replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"), "g");

export function defaultCanonicalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(ROOT_RE, "<ROOT>")
    .replace(TMP_RE, "<TMP>")
    .replace(/\b\d+(?:\.\d+)?\s*ms\b/g, "<MS>")
    .replace(/\b\d+(?:\.\d+)?\s*µs\b/g, "<US>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g, "<TS>")
    .replace(/^\s*provider:.*$/gm, "provider: <PROVIDER>")
    .replace(/^\s*runId:.*$/gm, "runId: <RUN>")
    .replace(/^\s*sessionId:.*$/gm, "sessionId: <SESSION>")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function gradeParity(
  forkText: string,
  upstreamText: string,
  extra?: (t: string) => string,
): { parity: Row["parity"]; notes: string; diffPreview: string } {
  const norm = (t: string) => (extra ? extra(defaultCanonicalize(t)) : defaultCanonicalize(t));
  const a = norm(forkText);
  const b = norm(upstreamText);
  if (a === b) return { parity: "match", notes: "", diffPreview: "" };

  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const aSet = new Set(aLines.map((l) => l.trim()).filter(Boolean));
  const bSet = new Set(bLines.map((l) => l.trim()).filter(Boolean));
  const overlap = [...aSet].filter((l) => bSet.has(l)).length;
  const union = new Set([...aSet, ...bSet]).size;
  const jaccard = union === 0 ? 0 : overlap / union;

  const onlyFork: string[] = [];
  const onlyUp: string[] = [];
  for (const l of aLines) if (l.trim() && !bSet.has(l.trim())) onlyFork.push(l);
  for (const l of bLines) if (l.trim() && !aSet.has(l.trim())) onlyUp.push(l);

  const preview = [
    "--- fork only ---",
    ...onlyFork.slice(0, DIVERGENCE_PREVIEW_LINES),
    "--- upstream only ---",
    ...onlyUp.slice(0, DIVERGENCE_PREVIEW_LINES),
  ].join("\n");

  const notes = `jaccard=${jaccard.toFixed(3)} f-only=${onlyFork.length} u-only=${onlyUp.length}`;
  if (jaccard >= 0.9) return { parity: "equivalent", notes, diffPreview: preview };
  return { parity: "divergent", notes, diffPreview: preview };
}

interface CallObservation {
  ms: number;
  bytes: number;
  ok: boolean;
  err?: string;
  text: string;
}

async function oneCall(client: McpStdioClient, s: Scenario): Promise<CallObservation> {
  try {
    const r = await client.call(s.tool, s.args);
    if (r.isError) {
      return {
        ms: r.ms,
        bytes: r.payloadBytes,
        ok: false,
        err: r.errorText || "tool returned isError: true",
        text: extractText(r.result),
      };
    }
    return { ms: r.ms, bytes: r.payloadBytes, ok: true, text: extractText(r.result) };
  } catch (e: any) {
    return { ms: 0, bytes: 0, ok: false, err: e.message, text: "" };
  }
}

export async function runScenario(
  fork: McpStdioClient,
  upstream: McpStdioClient | null,
  s: Scenario,
): Promise<Row> {
  const iterations = s.iterations ?? DEFAULT_ITERATIONS;
  const warmups = s.warmups ?? DEFAULT_WARMUPS;

  const row: Row = {
    scenario: s.name,
    tool: s.tool,
    iterations,
    fork: emptySide(),
    upstream: emptySide(),
    parity: "error",
    assertIssues: [],
    diffPreview: "",
    notes: "",
  };

  if (s.setup) {
    let setupFailed = false;
    try { await s.setup(fork); }
    catch (e: any) {
      row.fork = { ...emptySide(), attempts: 1, failures: 1, err: `setup: ${e.message}` };
      row.notes = `fork setup: ${e.message}`;
      setupFailed = true;
    }
    if (upstream) {
      try { await s.setup(upstream); }
      catch (e: any) {
        row.upstream = { ...emptySide(), attempts: 1, failures: 1, err: `setup: ${e.message}` };
        row.notes += ` upstream setup: ${e.message}`;
        setupFailed = true;
      }
    } else if (setupFailed) {
      row.upstream = { ok: true, err: "n/a (fork-only)", attempts: 0, successes: 0, failures: 0, ms: emptyStats(), bytes: emptyStats() };
    }
    if (setupFailed) {
      row.parity = "error";
      return row;
    }
  }

  for (let i = 0; i < warmups; i++) {
    await oneCall(fork, s);
    if (upstream) await oneCall(upstream, s);
  }

  const forkMs: number[] = [];
  const forkBytes: number[] = [];
  const upMs: number[] = [];
  const upBytes: number[] = [];
  let forkFailures = 0;
  let upFailures = 0;
  let lastForkText = "";
  let lastUpText = "";
  let forkErr: string | undefined;
  let upErr: string | undefined;

  for (let i = 0; i < iterations; i++) {
    const f = await oneCall(fork, s);
    if (f.ok) { forkMs.push(f.ms); forkBytes.push(f.bytes); lastForkText = f.text; }
    else { forkFailures++; forkErr = f.err || forkErr; }
    if (upstream) {
      const u = await oneCall(upstream, s);
      if (u.ok) { upMs.push(u.ms); upBytes.push(u.bytes); lastUpText = u.text; }
      else { upFailures++; upErr = u.err || upErr; }
    }
  }

  row.fork = {
    ok: forkMs.length === iterations && forkFailures === 0,
    err: forkErr,
    attempts: iterations,
    successes: forkMs.length,
    failures: forkFailures,
    ms: summarize(forkMs),
    bytes: summarize(forkBytes),
  };

  if (!upstream) {
    row.upstream = { ok: true, err: "n/a (fork-only)", attempts: 0, successes: 0, failures: 0, ms: emptyStats(), bytes: emptyStats() };
    row.parity = row.fork.ok ? "match" : "error";
    row.notes = (row.notes ? row.notes + " " : "") + "fork-only";
  } else {
    row.upstream = {
      ok: upMs.length === iterations && upFailures === 0,
      err: upErr,
      attempts: iterations,
      successes: upMs.length,
      failures: upFailures,
      ms: summarize(upMs),
      bytes: summarize(upBytes),
    };
    if (row.fork.ok && row.upstream.ok) {
      const g = gradeParity(lastForkText, lastUpText, s.canonicalize);
      row.parity = g.parity;
      row.notes = (row.notes ? row.notes + " " : "") + g.notes;
      row.diffPreview = g.diffPreview;
    } else {
      row.parity = "error";
      row.notes = (row.notes ? row.notes + " " : "") +
        `fork.ok=${row.fork.ok} fork=${row.fork.successes}/${row.fork.attempts} upstream.ok=${row.upstream.ok} upstream=${row.upstream.successes}/${row.upstream.attempts}`;
    }
  }

  if (s.assert) {
    try {
      const canon = s.canonicalize ? s.canonicalize(defaultCanonicalize(lastForkText)) : defaultCanonicalize(lastForkText);
      row.assertIssues = s.assert(canon);
    } catch (e: any) {
      row.assertIssues = [`assert threw: ${e.message}`];
    }
    if (row.assertIssues.length > 0 && row.parity === "match") {
      row.parity = "divergent";
      row.notes = (row.notes ? row.notes + " " : "") + `assert-failed=${row.assertIssues.length}`;
    }
  }

  return row;
}

export function pct(forkN: number, upN: number): string {
  if (upN === 0) return "n/a";
  const d = ((forkN - upN) / upN) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

export interface ReportMeta {
  suite: string;
  fork_sha: string;
  upstream_pin: string;
  node: string;
  platform: string;
  timestamp: string;
  iterations: string;
  warmups: string;
  [k: string]: string;
}

export function renderMarkdown(rows: Row[], meta: ReportMeta): string {
  const lines: string[] = [];
  lines.push(`# ${meta.suite} — fork vs upstream`);
  lines.push("");
  for (const [k, v] of Object.entries(meta)) lines.push(`- **${k}**: ${v}`);
  lines.push("");
  lines.push(`| Tool | Scenario | Iters | Parity | Fork ok | Up ok | Fork ms (med/p95) | Up ms (med/p95) | Δ med ms | Fork B (med) | Up B (med) | Δ B | Assert | Notes |`);
  lines.push(`|------|----------|-------|--------|---------|-------|-------------------|-----------------|----------|--------------|------------|-----|--------|-------|`);
  for (const r of rows) {
    const fM = r.fork.ms, uM = r.upstream.ms, fB = r.fork.bytes, uB = r.upstream.bytes;
    lines.push(
      `| ${r.tool} | ${r.scenario} | ${r.iterations} | ${r.parity} | ${r.fork.successes}/${r.fork.attempts} | ${r.upstream.successes}/${r.upstream.attempts} | ${fM.median.toFixed(1)} / ${fM.p95.toFixed(1)} | ${uM.median.toFixed(1)} / ${uM.p95.toFixed(1)} | ${pct(fM.median, uM.median)} | ${fB.median} | ${uB.median} | ${pct(fB.median, uB.median)} | ${r.assertIssues.length === 0 ? "ok" : `FAIL(${r.assertIssues.length})`} | ${r.notes || ""} |`,
    );
  }
  lines.push("");
  const counts = rows.reduce<Record<string, number>>((acc, r) => { acc[r.parity] = (acc[r.parity] || 0) + 1; return acc; }, {});
  lines.push(`**Summary:** ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);

  const failures = rows.filter((r) => r.parity === "divergent" || r.assertIssues.length > 0);
  if (failures.length > 0) {
    lines.push("");
    lines.push(`## Divergence / assertion details`);
    for (const r of failures) {
      lines.push("");
      lines.push(`### ${r.tool} — ${r.scenario}`);
      if (r.assertIssues.length > 0) {
        lines.push(`**Assert failures:**`);
        for (const i of r.assertIssues) lines.push(`- ${i}`);
      }
      if (r.diffPreview) {
        lines.push(`**Diff preview (first ${DIVERGENCE_PREVIEW_LINES} unique lines per side):**`);
        lines.push("```");
        lines.push(r.diffPreview);
        lines.push("```");
      }
    }
  }
  return lines.join("\n") + "\n";
}

export function readPinnedSha(): string {
  try { return readFileSync(join(repoRoot, ".compare", "UPSTREAM_SHA"), "utf8").trim(); } catch {}
  try {
    const parsed = JSON.parse(readFileSync(join(repoRoot, "scripts", "compare", "upstream-pin.json"), "utf8"));
    return typeof parsed?.sha === "string" && parsed.sha.trim() ? parsed.sha.trim() : "unknown";
  } catch {}
  return "unknown";
}

export function buildMeta(suite: string): ReportMeta {
  return {
    suite,
    fork_sha: process.env.GITHUB_SHA || "local",
    upstream_pin: readPinnedSha(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    timestamp: new Date().toISOString(),
    iterations: String(DEFAULT_ITERATIONS),
    warmups: String(DEFAULT_WARMUPS),
  };
}

export function writeReport(suite: string, rows: Row[], meta: ReportMeta): { jsonPath: string; mdPath: string } {
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `${suite}-${ts}.json`);
  const mdPath = join(reportDir, `${suite}-${ts}.md`);
  writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 2));
  writeFileSync(mdPath, renderMarkdown(rows, meta));
  return { jsonPath, mdPath };
}

export function isolateEnv(suffix = ""): Record<string, string> {
  const home = join(tmpdir(), `compare-${suffix || "x"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(home, { recursive: true });
  return { CONTEXT_MODE_HOME: home, CONTEXT_MODE_SILENT: "1" };
}

export async function withClients<T>(
  forkEnv: Record<string, string>,
  upstreamEnv: Record<string, string>,
  fn: (fork: McpStdioClient, upstream: McpStdioClient) => Promise<T>,
): Promise<T> {
  const fork = new McpStdioClient(forkServer, { env: forkEnv });
  const upstream = new McpStdioClient(upstreamServer, { env: upstreamEnv });
  try {
    await Promise.all([fork.initialize(), upstream.initialize()]);
    return await fn(fork, upstream);
  } finally {
    fork.close();
    upstream.close();
  }
}

export async function withForkOnly<T>(
  forkEnv: Record<string, string>,
  fn: (fork: McpStdioClient) => Promise<T>,
): Promise<T> {
  const fork = new McpStdioClient(forkServer, { env: forkEnv });
  try {
    await fork.initialize();
    return await fn(fork);
  } finally {
    fork.close();
  }
}

export function logRow(r: Row): void {
  const fM = r.fork.ms, uM = r.upstream.ms;
  const assertTag = r.assertIssues.length === 0 ? "" : ` ASSERT-FAIL(${r.assertIssues.length})`;
  console.log(`[compare] ${r.tool.padEnd(20)} ${r.scenario.padEnd(28)} ${r.parity.padEnd(11)} fork=${fM.median.toFixed(1)}/${fM.p95.toFixed(1)}ms (${r.fork.bytes.median}B) up=${uM.median.toFixed(1)}/${uM.p95.toFixed(1)}ms (${r.upstream.bytes.median}B) ${r.notes || ""}${assertTag}`);
}

export function exitOnFailure(rows: Row[]): never | void {
  const failed = rows.filter((r) => r.parity === "divergent" || r.parity === "error" || r.assertIssues.length > 0);
  if (failed.length > 0) {
    console.error(`[compare] ${failed.length} scenario(s) divergent / errored / assert-failed`);
    process.exit(1);
  }
}
