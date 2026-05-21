// Workflow runner — multi-tool sequences emulating real Claude Code sessions.
// Each workflow is an ordered list of (tool, args) steps run sequentially.
// Some steps depend on prior step results (e.g. search for a string found in
// previous output), expressed via a builder fn that receives WorkflowContext.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpStdioClient } from "../runner.js";
import {
  buildMeta, extractText, isolateEnv, readPinnedSha, reportDir, repoRoot, withClients, withForkOnly,
  type ReportMeta,
} from "../lib.js";

export interface WorkflowContext {
  /** Outputs of each prior step, keyed by step label. Text payload only. */
  outputs: Record<string, string>;
}

export type ArgsBuilder = Record<string, unknown> | ((ctx: WorkflowContext) => Record<string, unknown>);

export interface WorkflowStep {
  label: string;
  tool: string;
  args: ArgsBuilder;
  /** Optional setup that runs once on each client before this step (e.g. write a temp file). */
  setup?: (client: McpStdioClient, ctx: WorkflowContext) => Promise<void>;
  /** Treat MCP isError output as a valid step result when the oracle accepts the error text. */
  allowError?: boolean;
  /** Quality oracle — receives text payload, returns true|[] for pass, false|[issue]
   *  for fail. Used to compute "was the answer sufficient" alongside bytes. */
  assert?: (text: string) => boolean | string[];
}

export interface Workflow {
  name: string;
  description: string;
  steps: WorkflowStep[];
  /** Extra env vars merged into the isolated CONTEXT_MODE_HOME env. */
  env?: Record<string, string>;
  /** Returns raw byte cost if the equivalent work was done without context-mode.
   *  Used to compute end-to-end savings %. */
  rawBaseline?: () => Promise<number>;
  /** Optional async global setup (e.g. start fixture server). */
  beforeAll?(): Promise<void>;
  afterAll?(): Promise<void>;
  /** If true, the workflow uses tools upstream doesn't expose; skip upstream
   *  client and report fork-only totals. Upstream columns render as `n/a`. */
  forkOnly?: boolean;
}

export interface StepResult {
  label: string;
  tool: string;
  /** UTF-8 bytes of JSON-serialized resolved args. Same on fork+upstream. */
  argsBytes: number;
  ms: number;
  bytes: number;
  ok: boolean;
  err?: string;
  /** Whether a quality oracle was defined for this step. */
  hasOracle?: boolean;
  /** Did the response payload pass the oracle? null = no oracle defined. */
  oracleOk?: boolean | null;
  /** Optional issues reported by the oracle. Empty array means pass. */
  oracleIssues?: string[];
}

export interface WorkflowSideResult {
  ok: boolean;
  totalMs: number;
  totalBytes: number;
  steps: StepResult[];
  /** Oracle pass count / oracle defined count (excludes steps without oracles). */
  oraclePassed?: number;
  oracleTotal?: number;
}

export interface WorkflowRow {
  workflow: string;
  description: string;
  fork: WorkflowSideResult;
  upstream: WorkflowSideResult;
  rawBaseline?: number;
  forkSavingsPct?: number;
  upstreamSavingsPct?: number;
}

function resolveArgs(b: ArgsBuilder, ctx: WorkflowContext): Record<string, unknown> {
  return typeof b === "function" ? b(ctx) : b;
}

const PROJECT_DIR_TOOLS = new Set([
  "ctx_batch_execute",
  "ctx_diff",
  "ctx_execute",
  "ctx_execute_file",
  "ctx_fetch_and_index",
  "ctx_fetch_run",
  "ctx_index",
  "ctx_read",
  "ctx_search",
]);

function withDefaultProjectDir(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!PROJECT_DIR_TOOLS.has(tool) || typeof args.projectDir === "string") return args;
  return { ...args, projectDir: repoRoot };
}

async function runSide(client: McpStdioClient, wf: Workflow): Promise<WorkflowSideResult> {
  const ctx: WorkflowContext = { outputs: {} };
  const steps: StepResult[] = [];
  let totalMs = 0;
  let totalBytes = 0;
  for (const step of wf.steps) {
    if (step.setup) {
      try {
        await step.setup(client, ctx);
      } catch (e: any) {
        steps.push({
          label: step.label,
          tool: step.tool,
          argsBytes: 0,
          ms: 0,
          bytes: 0,
          ok: false,
          err: `setup: ${e.message}`,
        });
        break;
      }
    }
    const args = withDefaultProjectDir(step.tool, resolveArgs(step.args, ctx));
    const argsBytes = Buffer.byteLength(JSON.stringify(args ?? {}), "utf8");
    const hasOracle = typeof step.assert === "function";
    const res: StepResult = { label: step.label, tool: step.tool, argsBytes, ms: 0, bytes: 0, ok: false, hasOracle, oracleOk: null, oracleIssues: [] };
    let text = "";
    try {
      const r = await client.call(step.tool, args);
      res.ms = r.ms;
      res.bytes = r.bytes;
      text = extractText(r.result);
      ctx.outputs[step.label] = text;
      if (r.isError) {
        if (step.allowError) res.ok = true;
        else res.err = r.errorText || "tool returned isError: true";
      } else {
        res.ok = true;
      }
    } catch (e: any) {
      res.err = e.message;
      ctx.outputs[step.label] = "";
    }
    if (hasOracle) {
      try {
        const verdict = step.assert!(text);
        if (verdict === true) { res.oracleOk = true; res.oracleIssues = []; }
        else if (verdict === false) { res.oracleOk = false; res.oracleIssues = ["oracle returned false"]; }
        else if (Array.isArray(verdict)) {
          res.oracleIssues = verdict;
          res.oracleOk = verdict.length === 0;
        } else {
          res.oracleOk = null;
          res.oracleIssues = ["oracle returned non-boolean / non-array"];
        }
      } catch (e: any) {
        res.oracleOk = false;
        res.oracleIssues = [`oracle threw: ${e.message}`];
      }
    }
    totalMs += res.ms;
    totalBytes += res.bytes;
    steps.push(res);
    if (!res.ok) break;
  }
  const oracleTotal = steps.filter((s) => s.hasOracle).length;
  const oraclePassed = steps.filter((s) => s.hasOracle && s.oracleOk === true).length;
  const toolsOk = steps.length === wf.steps.length && steps.every((step) => step.ok);
  const oraclesOk = steps.every((step) => !step.hasOracle || step.oracleOk === true);
  return { ok: toolsOk && oraclesOk, totalMs, totalBytes, steps, oracleTotal, oraclePassed };
}

export async function runWorkflowWithClients(
  wf: Workflow,
  fork: McpStdioClient,
  upstream: McpStdioClient,
): Promise<WorkflowRow> {
  const forkRes = await runSide(fork, wf);
  const upRes = await runSide(upstream, wf);
  const out: WorkflowRow = {
    workflow: wf.name,
    description: wf.description,
    fork: forkRes,
    upstream: upRes,
  };
  if (wf.rawBaseline) {
    const raw = await wf.rawBaseline();
    out.rawBaseline = raw;
    if (raw > 0) {
      out.forkSavingsPct = (1 - forkRes.totalBytes / raw) * 100;
      out.upstreamSavingsPct = (1 - upRes.totalBytes / raw) * 100;
    }
  }
  return out;
}

export function workflowRowOk(row: WorkflowRow): boolean {
  return row.fork.ok && row.upstream.ok;
}

export async function runWorkflow(wf: Workflow): Promise<WorkflowRow> {
  if (wf.beforeAll) await wf.beforeAll();
  const forkEnv = { ...isolateEnv(`${wf.name}-fork`), ...(wf.env || {}) };
  let row: WorkflowRow;
  try {
    if (wf.forkOnly) {
      row = await withForkOnly(forkEnv, async (fork) => {
        const forkRes = await runSide(fork, wf);
        const out: WorkflowRow = {
          workflow: wf.name,
          description: wf.description,
          fork: forkRes,
          upstream: { ok: true, totalMs: 0, totalBytes: 0, steps: [] },
        };
        if (wf.rawBaseline) {
          const raw = await wf.rawBaseline();
          out.rawBaseline = raw;
          if (raw > 0) out.forkSavingsPct = (1 - forkRes.totalBytes / raw) * 100;
        }
        return out;
      });
    } else {
      const upEnv = { ...isolateEnv(`${wf.name}-upstream`), ...(wf.env || {}) };
      row = await withClients(forkEnv, upEnv, async (fork, upstream) => {
        return runWorkflowWithClients(wf, fork, upstream);
      });
    }
  } finally {
    if (wf.afterAll) await wf.afterAll();
  }
  return row;
}

function pct(forkN: number, upN: number): string {
  if (upN === 0) return "n/a";
  const d = ((forkN - upN) / upN) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

export function renderWorkflowMd(rows: WorkflowRow[], meta: ReportMeta): string {
  const lines: string[] = [];
  lines.push(`# ${meta.suite} — fork vs upstream workflow comparison`);
  lines.push("");
  for (const [k, v] of Object.entries(meta)) lines.push(`- **${k}**: ${v}`);
  lines.push("");

  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Workflow | Status | Steps | Fork ms | Up ms | Δ ms | Fork B | Up B | Δ B | Raw B | Fork save % | Up save % | Oracle (fork) | Oracle (up) |`);
  lines.push(`|----------|--------|-------|---------|-------|------|--------|------|-----|-------|-------------|-----------|---------------|-------------|`);
  for (const r of rows) {
    const orF = (r.fork.oracleTotal ?? 0) === 0 ? "—" : `${r.fork.oraclePassed}/${r.fork.oracleTotal}`;
    const orU = (r.upstream.oracleTotal ?? 0) === 0 ? "—" : `${r.upstream.oraclePassed}/${r.upstream.oracleTotal}`;
    lines.push(
      `| ${r.workflow} | ${workflowRowOk(r) ? "ok" : "failed"} | ${r.fork.steps.length} | ${r.fork.totalMs.toFixed(0)} | ${r.upstream.totalMs.toFixed(0)} | ${pct(r.fork.totalMs, r.upstream.totalMs)} | ${r.fork.totalBytes} | ${r.upstream.totalBytes} | ${pct(r.fork.totalBytes, r.upstream.totalBytes)} | ${r.rawBaseline ?? "-"} | ${r.forkSavingsPct !== undefined ? r.forkSavingsPct.toFixed(1) : "-"} | ${r.upstreamSavingsPct !== undefined ? r.upstreamSavingsPct.toFixed(1) : "-"} | ${orF} | ${orU} |`,
    );
  }
  lines.push("");

  for (const r of rows) {
    lines.push(`## ${r.workflow}`);
    lines.push("");
    lines.push(r.description);
    lines.push("");
    lines.push(`| # | Label | Tool | Fork | Up | Fork ms | Up ms | Fork B | Up B | Oracle (fork) | Oracle (up) |`);
    lines.push(`|---|-------|------|------|----|---------|-------|--------|------|---------------|-------------|`);
    for (let i = 0; i < r.fork.steps.length; i++) {
      const f = r.fork.steps[i];
      const u = r.upstream.steps[i];
      const orF = f.hasOracle ? (f.oracleOk === true ? "✓" : f.oracleOk === false ? `✗ ${(f.oracleIssues ?? []).slice(0, 1).join(";").slice(0, 60)}` : "?") : "—";
      const orU = u?.hasOracle ? (u.oracleOk === true ? "✓" : u.oracleOk === false ? `✗ ${(u.oracleIssues ?? []).slice(0, 1).join(";").slice(0, 60)}` : "?") : "—";
      lines.push(
        `| ${i + 1} | ${f.label} | ${f.tool} | ${f.ok ? "ok" : `FAIL: ${f.err ?? ""}`} | ${u?.ok ? "ok" : `FAIL: ${u?.err ?? ""}`} | ${f.ms.toFixed(1)} | ${(u?.ms ?? 0).toFixed(1)} | ${f.bytes} | ${u?.bytes ?? 0} | ${orF} | ${orU} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

export function writeWorkflowReport(rows: WorkflowRow[]): { jsonPath: string; mdPath: string } {
  mkdirSync(reportDir, { recursive: true });
  const meta = buildMeta("workflows");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `workflows-${ts}.json`);
  const mdPath = join(reportDir, `workflows-${ts}.md`);
  writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 2));
  writeFileSync(mdPath, renderWorkflowMd(rows, meta));
  return { jsonPath, mdPath };
}

export function logWorkflow(r: WorkflowRow): void {
  console.log(`[compare] ${r.workflow.padEnd(20)} status=${workflowRowOk(r) ? "ok" : "FAILED"} fork=${r.fork.totalMs.toFixed(0)}ms/${r.fork.totalBytes}B  up=${r.upstream.totalMs.toFixed(0)}ms/${r.upstream.totalBytes}B  save=${r.forkSavingsPct !== undefined ? r.forkSavingsPct.toFixed(1) + "%" : "-"} (fork) vs ${r.upstreamSavingsPct !== undefined ? r.upstreamSavingsPct.toFixed(1) + "%" : "-"} (up)`);
}

export { readPinnedSha };
