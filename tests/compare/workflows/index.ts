// Workflow runner — multi-tool sequences emulating real Claude Code sessions.
// Each workflow is an ordered list of (tool, args) steps run sequentially.
// Some steps depend on prior step results (e.g. search for a string found in
// previous output), expressed via a builder fn that receives WorkflowContext.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpStdioClient } from "../runner.js";
import {
  buildMeta, extractText, isolateEnv, readPinnedSha, reportDir, withClients,
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
}

export interface StepResult {
  label: string;
  tool: string;
  ms: number;
  bytes: number;
  ok: boolean;
  err?: string;
}

export interface WorkflowSideResult {
  ok: boolean;
  totalMs: number;
  totalBytes: number;
  steps: StepResult[];
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
          ms: 0,
          bytes: 0,
          ok: false,
          err: `setup: ${e.message}`,
        });
        break;
      }
    }
    const args = resolveArgs(step.args, ctx);
    const res: StepResult = { label: step.label, tool: step.tool, ms: 0, bytes: 0, ok: false };
    try {
      const r = await client.call(step.tool, args);
      res.ms = r.ms;
      res.bytes = r.bytes;
      if (r.isError) {
        res.err = r.errorText || "tool returned isError: true";
        ctx.outputs[step.label] = extractText(r.result);
      } else {
        res.ok = true;
        ctx.outputs[step.label] = extractText(r.result);
      }
    } catch (e: any) {
      res.err = e.message;
      ctx.outputs[step.label] = "";
    }
    totalMs += res.ms;
    totalBytes += res.bytes;
    steps.push(res);
    if (!res.ok) break;
  }
  return { ok: steps.length === wf.steps.length && steps.every((step) => step.ok), totalMs, totalBytes, steps };
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
  const upEnv = { ...isolateEnv(`${wf.name}-upstream`), ...(wf.env || {}) };
  let row: WorkflowRow;
  try {
    row = await withClients(forkEnv, upEnv, async (fork, upstream) => {
      return runWorkflowWithClients(wf, fork, upstream);
    });
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
  lines.push(`| Workflow | Status | Steps | Fork ms | Up ms | Δ ms | Fork B | Up B | Δ B | Raw B | Fork save % | Up save % |`);
  lines.push(`|----------|--------|-------|---------|-------|------|--------|------|-----|-------|-------------|-----------|`);
  for (const r of rows) {
    lines.push(
      `| ${r.workflow} | ${workflowRowOk(r) ? "ok" : "failed"} | ${r.fork.steps.length} | ${r.fork.totalMs.toFixed(0)} | ${r.upstream.totalMs.toFixed(0)} | ${pct(r.fork.totalMs, r.upstream.totalMs)} | ${r.fork.totalBytes} | ${r.upstream.totalBytes} | ${pct(r.fork.totalBytes, r.upstream.totalBytes)} | ${r.rawBaseline ?? "-"} | ${r.forkSavingsPct !== undefined ? r.forkSavingsPct.toFixed(1) : "-"} | ${r.upstreamSavingsPct !== undefined ? r.upstreamSavingsPct.toFixed(1) : "-"} |`,
    );
  }
  lines.push("");

  for (const r of rows) {
    lines.push(`## ${r.workflow}`);
    lines.push("");
    lines.push(r.description);
    lines.push("");
    lines.push(`| # | Label | Tool | Fork | Up | Fork ms | Up ms | Fork B | Up B |`);
    lines.push(`|---|-------|------|------|----|---------|-------|--------|------|`);
    for (let i = 0; i < r.fork.steps.length; i++) {
      const f = r.fork.steps[i];
      const u = r.upstream.steps[i];
      lines.push(
        `| ${i + 1} | ${f.label} | ${f.tool} | ${f.ok ? "ok" : `FAIL: ${f.err ?? ""}`} | ${u?.ok ? "ok" : `FAIL: ${u?.err ?? ""}`} | ${f.ms.toFixed(1)} | ${(u?.ms ?? 0).toFixed(1)} | ${f.bytes} | ${u?.bytes ?? 0} |`,
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
