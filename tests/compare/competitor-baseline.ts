// Runs every Phase 1+1.5 workflow against every available competitor adapter.
// Writes a JSON artifact: build/compare/competitor-baseline-<ts>.json.
//
// Per-step pipeline:
//   1. Detect adapter (skip workflow if missing).
//   2. Dispatch by step.kind (command/read/fetch/search).
//   3. If adapter step errors, apply workflow.fallbackPolicy = "raw-on-error":
//      retry via raw adapter, mark result with fallbackUsed=true.
//   4. Run step.assert(text) if provided; record oracleOk + oracleIssues.
//   5. Capture bytes/tokens/ms.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALL_ADAPTERS, shutdownAllMcpClients } from "./competitors/index.js";
import { rawAdapter } from "./competitors/raw.js";
import type {
  CompetitorAdapter,
  CompetitorRunResult,
  CompetitorWorkflowResult,
} from "./competitors/lib.js";
import { PHASE1_WORKFLOWS } from "./workflows-competitors/index.js";
import type { AnyStep, CompetitorWorkflow } from "./workflows-competitors/types.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BUILD_DIR = resolve(REPO_ROOT, "build", "compare");

interface BaselineFile {
  readonly meta: {
    readonly generatedAt: string;
    readonly platform: NodeJS.Platform;
    readonly nodeVersion: string;
    readonly cwd: string;
    readonly samples: number;
    readonly adapters: ReadonlyArray<{
      readonly id: string;
      readonly available: boolean;
      readonly version?: string;
      readonly reason?: string;
      readonly installSizeBytes?: number;
    }>;
  };
  readonly rows: readonly CompetitorWorkflowResult[];
}

function parseCsvEnv(name: string): Set<string> | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
}

function applyOracle(step: AnyStep, text: string): { ok: boolean; issues: string[] } {
  if (!step.assert) return { ok: true, issues: [] };
  try {
    const verdict = step.assert(text);
    if (verdict === true) return { ok: true, issues: [] };
    if (verdict === false) return { ok: false, issues: ["oracle returned false"] };
    if (Array.isArray(verdict)) return { ok: verdict.length === 0, issues: verdict };
    return { ok: true, issues: [] };
  } catch (err) {
    return { ok: false, issues: [`oracle threw: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

async function runStep(
  adapter: CompetitorAdapter,
  step: AnyStep,
  workflow: CompetitorWorkflow,
): Promise<CompetitorRunResult> {
  let res: CompetitorRunResult;

  // Per-step skip filters.
  if (step.skipForTools?.includes(adapter.id)) {
    return {
      tool: adapter.id, stepLabel: step.label, ms: 0, bytes: 0, tokens: 0,
      ok: true, errorReason: "skipped by step.skipForTools",
    };
  }
  if (step.onlyForTools && !step.onlyForTools.includes(adapter.id)) {
    return {
      tool: adapter.id, stepLabel: step.label, ms: 0, bytes: 0, tokens: 0,
      ok: true, errorReason: "step restricted to other tools",
    };
  }

  const keepOutput = !!step.assert;

  try {
    switch (step.kind) {
      case "command":
        res = await adapter.runCommand(step.command, { timeoutMs: step.timeoutMs, cwd: step.cwd, keepOutput });
        break;
      case "read":
        if (adapter.readFile) {
          res = await adapter.readFile(step.path, { mode: step.mode, start: step.start, end: step.end, compact: step.compact, keepOutput });
        } else {
          res = makeMissing(adapter.id, step.label, "adapter lacks readFile");
        }
        break;
      case "fetch":
        if (adapter.fetchUrl) {
          res = await adapter.fetchUrl(step.url, { keepOutput });
        } else {
          res = makeMissing(adapter.id, step.label, "adapter lacks fetchUrl");
        }
        break;
      case "search":
        if (adapter.search) {
          res = await adapter.search(step.query, { source: step.source, keepOutput });
        } else {
          res = makeMissing(adapter.id, step.label, "adapter lacks search");
        }
        break;
      case "index":
        if (adapter.index) {
          res = await adapter.index({ path: step.path, command: step.command, source: step.source, timeoutMs: step.timeoutMs, keepOutput });
        } else {
          res = makeMissing(adapter.id, step.label, "adapter lacks index");
        }
        break;
      default:
        res = makeMissing(adapter.id, (step as any).label ?? "unknown", `unknown step.kind=${(step as any).kind}`);
    }
  } catch (err) {
    res = makeMissing(adapter.id, step.label, err instanceof Error ? err.message : String(err));
  }

  // Fallback to raw when adapter errored or returned ok:false.
  const originalError = !res.ok ? (res.errorReason ?? "adapter ok=false") : undefined;
  if (!res.ok && workflow.fallbackPolicy !== "none" && adapter.id !== "raw") {
    const fallback = await runRawFallback(step, keepOutput);
    res = {
      ...fallback,
      tool: adapter.id,
      stepLabel: step.label,
      fallbackUsed: true,
      originalAdapterError: originalError,
      errorReason: `adapter failed: ${originalError}; fell back to raw`,
    };
  }

  // Oracle check. When fallback fired, the adapter's error message often
  // IS the right thing to evaluate (e.g. "binary file blocked"). Include both.
  if (step.assert) {
    const oracleInput = [res.output ?? "", res.originalAdapterError ?? ""].join("\n");
    const oracle = applyOracle(step, oracleInput);
    res = { ...res, oracleOk: oracle.ok, oracleIssues: oracle.issues };
  }

  return { ...res, stepLabel: step.label };
}

async function runRawFallback(step: AnyStep, keepOutput: boolean): Promise<CompetitorRunResult> {
  switch (step.kind) {
    case "command":
      return rawAdapter.runCommand(step.command, { timeoutMs: step.timeoutMs, cwd: step.cwd, keepOutput });
    case "read":
      return rawAdapter.readFile!(step.path, { mode: step.mode, start: step.start, end: step.end, keepOutput });
    case "fetch":
      return rawAdapter.fetchUrl!(step.url, { keepOutput });
    case "search":
      return rawAdapter.search!(step.query, { source: step.source, keepOutput });
    case "index":
      return rawAdapter.index!({ path: step.path, command: step.command, source: step.source, timeoutMs: step.timeoutMs, keepOutput });
  }
}

function makeMissing(tool: string, label: string, reason: string): CompetitorRunResult {
  return { tool: tool as any, stepLabel: label, ms: 0, bytes: 0, tokens: 0, ok: false, errorReason: reason };
}

async function runAdapterOnWorkflow(
  adapter: CompetitorAdapter,
  workflow: CompetitorWorkflow,
  samples: number,
): Promise<{ result: CompetitorWorkflowResult; stepCount: number }> {
  if (workflow.beforeAll) await workflow.beforeAll();
  try {
    const stepResults: CompetitorRunResult[] = [];
    let totalBytes = 0;
    let totalTokens = 0;
    let totalMs = 0;
    for (const step of workflow.steps) {
      const res = await runStepWithSamples(adapter, step, workflow, samples);
      stepResults.push(res);
      totalBytes += res.bytes;
      totalTokens += res.tokens;
      totalMs += res.ms;
    }
    return {
      result: {
        tool: adapter.id, workflow: workflow.name,
        totalBytes, totalTokens, totalMs,
        steps: stepResults, available: true,
      },
      stepCount: workflow.steps.length,
    };
  } finally {
    if (workflow.afterAll) await workflow.afterAll();
  }
}

// N-sample wrapper: re-run command/read/fetch/search steps multiple times,
// keep median bytes + min/max + median ms. Index/large/network steps run once
// (cost prohibits and N=1 is fine for size-stable artifacts).
function shouldSampleMultiple(step: AnyStep, samples: number): boolean {
  if (samples <= 1) return false;
  if (step.kind === "index") return false;
  if (step.kind === "fetch") return false; // network jitter dominates; one sample is honest
  return true;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

async function runStepWithSamples(
  adapter: CompetitorAdapter,
  step: AnyStep,
  workflow: CompetitorWorkflow,
  samples: number,
): Promise<CompetitorRunResult> {
  if (!shouldSampleMultiple(step, samples)) {
    return runStep(adapter, step, workflow);
  }
  const results: CompetitorRunResult[] = [];
  for (let i = 0; i < samples; i++) {
    results.push(await runStep(adapter, step, workflow));
  }
  // Use median bytes + median ms; ok is true if any sample succeeded; oracle uses
  // last sample's verdict (assertions are deterministic; samples differ only in latency).
  const medBytes = median(results.map((r) => r.bytes));
  const medMs = median(results.map((r) => r.ms));
  const anyOk = results.some((r) => r.ok);
  const last = results[results.length - 1];
  return {
    ...last,
    bytes: medBytes,
    tokens: Math.ceil(medBytes / 4),
    ms: medMs,
    ok: anyOk,
  };
}

async function main(): Promise<void> {
  mkdirSync(BUILD_DIR, { recursive: true });
  // Default N=3 — three runs per resampleable step, median used. Set
  // COMPETITOR_SAMPLES=1 to disable for quick smoke tests.
  const SAMPLES = Math.max(1, Math.floor(Number(process.env.COMPETITOR_SAMPLES ?? "3")));
  console.log(`[competitors] sampling N=${SAMPLES} per resampleable step (set COMPETITOR_SAMPLES=1 to disable)`);
  const toolFilter = parseCsvEnv("COMPETITOR_TOOLS");
  const workflowFilter = parseCsvEnv("COMPETITOR_WORKFLOWS");
  if (toolFilter) {
    console.log(`[competitors] tool filter: ${[...toolFilter].join(", ")}`);
  }
  if (workflowFilter) {
    console.log(`[competitors] workflow filter: ${[...workflowFilter].join(", ")}`);
  }

  const adapterAvailability: Array<{ id: string; available: boolean; version?: string; reason?: string; installSizeBytes?: number }> = [];
  const availableAdapters: CompetitorAdapter[] = [];
  console.log("[competitors] detecting adapters...");
  const selectedAdapters = toolFilter
    ? ALL_ADAPTERS.filter((adapter) => toolFilter.has(adapter.id))
    : ALL_ADAPTERS;
  if (selectedAdapters.length === 0) {
    throw new Error(`COMPETITOR_TOOLS matched no adapters: ${[...(toolFilter ?? [])].join(", ")}`);
  }
  for (const adapter of selectedAdapters) {
    const det = await adapter.detect();
    adapterAvailability.push({
      id: adapter.id, available: det.available, version: det.version,
      reason: det.reason, installSizeBytes: det.installSizeBytes,
    });
    if (det.available) {
      availableAdapters.push(adapter);
      const size = det.installSizeBytes ? ` (${(det.installSizeBytes / 1024).toFixed(0)}KB install)` : "";
      console.log(`  ✓ ${adapter.id.padEnd(28)} ${det.version ?? ""}${size}`);
    } else {
      console.log(`  ✗ ${adapter.id.padEnd(28)} skip: ${det.reason}`);
    }
  }

  // Pre-flight calibration — each tool's optional calibrate() runs once.
  console.log("[competitors] calibration...");
  for (const adapter of availableAdapters) {
    if (!adapter.calibrate) {
      console.log(`  · ${adapter.id.padEnd(28)} (no calibrate)`);
      continue;
    }
    try {
      const r = await adapter.calibrate();
      console.log(`  ${r.ok ? "✓" : "✗"} ${adapter.id.padEnd(28)} ${r.reason ?? "OK"}`);
    } catch (err) {
      console.log(`  ✗ ${adapter.id.padEnd(28)} calibration threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const rows: CompetitorWorkflowResult[] = [];
  const selectedWorkflows = workflowFilter
    ? PHASE1_WORKFLOWS.filter((workflow) => workflowFilter.has(workflow.name))
    : PHASE1_WORKFLOWS;
  if (selectedWorkflows.length === 0) {
    throw new Error(`COMPETITOR_WORKFLOWS matched no workflows: ${[...(workflowFilter ?? [])].join(", ")}`);
  }
  for (const workflow of selectedWorkflows) {
    for (const adapter of availableAdapters) {
      console.log(`[competitors] ${adapter.id} × ${workflow.name}`);
      try {
        const { result: row, stepCount } = await runAdapterOnWorkflow(adapter, workflow, SAMPLES);
        rows.push(row);
        const oracleSummary = (() => {
          const withOracle = row.steps.filter((s) => s.oracleOk !== undefined);
          if (withOracle.length === 0) return "";
          const passed = withOracle.filter((s) => s.oracleOk).length;
          return ` oracle=${passed}/${withOracle.length}`;
        })();
        const fallbackSummary = (() => {
          const fb = row.steps.filter((s) => s.fallbackUsed).length;
          return fb > 0 ? ` fallback=${fb}` : "";
        })();
        console.log(`  ${stepCount} steps, total: ${row.totalBytes}B ${row.totalTokens}tok ${row.totalMs}ms${oracleSummary}${fallbackSummary}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ERR ${adapter.id} × ${workflow.name}: ${message}`);
        rows.push({
          tool: adapter.id, workflow: workflow.name,
          totalBytes: 0, totalTokens: 0, totalMs: 0,
          steps: [], available: false, skipReason: message,
        });
      }
    }
  }

  await shutdownAllMcpClients();

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(BUILD_DIR, `competitor-baseline-${ts}.json`);
  const file: BaselineFile = {
    meta: {
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      samples: SAMPLES,
      adapters: adapterAvailability,
    },
    rows,
  };
  writeFileSync(outPath, JSON.stringify(file, null, 2));
  console.log(`[competitors] wrote ${outPath}`);

  // Companion lockfile — reproducibility snapshot at run time.
  const lockPath = join(BUILD_DIR, `competitor-versions-${ts}.lock`);
  const lockLines = [
    `# Competitor versions captured at ${new Date().toISOString()}`,
    `# platform: ${process.platform}  node: ${process.version}  samples: N=${SAMPLES}`,
    "",
    ...adapterAvailability.map((a) => `${a.id.padEnd(28)}\t${a.available ? "✓" : "✗"}\t${a.version ?? a.reason ?? ""}`),
  ];
  writeFileSync(lockPath, lockLines.join("\n"));
  console.log(`[competitors] wrote ${lockPath}`);
}

main().catch((err) => {
  console.error("[competitors] fatal:", err);
  process.exit(1);
});
