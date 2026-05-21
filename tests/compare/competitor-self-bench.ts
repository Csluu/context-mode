// Runs each competitor's OWN benchmark subcommand and compares its claim to
// our harness measurement. Tools have varying levels of self-bench support:
//   - squeez:     `squeez benchmark --json`
//   - lean-ctx:   `lean-ctx benchmark report .`
//   - chop:       no self-bench (only `gain` history)
//   - cc / sqz / fork: no native self-bench
//
// Output: build/compare/self-bench-<ts>.{md,json} side-by-side our verdict.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnCapture } from "./competitors/lib.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BUILD_DIR = resolve(REPO_ROOT, "build", "compare");

interface SelfBenchResult {
  tool: string;
  available: boolean;
  claimedSavedPct?: number;
  raw?: string;
  reason?: string;
}

async function runSqueezBench(): Promise<SelfBenchResult> {
  const r = spawnCapture("squeez", ["benchmark", "--json"], { timeoutMs: 180_000 });
  if (r.exitCode !== 0) return { tool: "squeez", available: false, reason: `exit=${r.exitCode}: ${r.stderrText.slice(0, 200)}` };
  try {
    const data = JSON.parse(r.stdoutText);
    // squeez emits `total_reduction_pct`; try common fields too.
    const claimed = data.total_reduction_pct ?? data.totalSavingsPct ?? data.savings_pct ?? data.savedPct ?? data.aggregate?.saved_pct;
    return { tool: "squeez", available: true, claimedSavedPct: claimed, raw: r.stdoutText.slice(0, 2000) };
  } catch {
    return { tool: "squeez", available: false, reason: "non-JSON output", raw: r.stdoutText.slice(0, 500) };
  }
}

async function runLeanCtxBench(): Promise<SelfBenchResult> {
  const r = spawnCapture("lean-ctx", ["benchmark", "run", ".", "--json"], { timeoutMs: 180_000, cwd: REPO_ROOT });
  if (r.exitCode !== 0) {
    // Try report form.
    const r2 = spawnCapture("lean-ctx", ["benchmark", "report", "."], { timeoutMs: 60_000, cwd: REPO_ROOT });
    if (r2.exitCode !== 0) return { tool: "lean-ctx", available: false, reason: `exit=${r.exitCode}: ${r.stderrText.slice(0, 200)}` };
    return { tool: "lean-ctx", available: true, raw: r2.stdoutText.slice(0, 2000) };
  }
  try {
    const data = JSON.parse(r.stdoutText);
    const claimed = data.savings_pct ?? data.totalSavingsPct ?? data.avgReduction;
    return { tool: "lean-ctx", available: true, claimedSavedPct: claimed, raw: r.stdoutText.slice(0, 2000) };
  } catch {
    return { tool: "lean-ctx", available: true, reason: "non-JSON output", raw: r.stdoutText.slice(0, 500) };
  }
}

function latestHarnessResult(): { rows: any[]; meta: any } | null {
  try {
    mkdirSync(BUILD_DIR, { recursive: true });
    const files = readdirSync(BUILD_DIR).filter((f) => f.startsWith("competitor-baseline-") && f.endsWith(".json")).sort();
    if (files.length === 0) return null;
    return JSON.parse(readFileSync(join(BUILD_DIR, files[files.length - 1]), "utf8"));
  } catch { return null; }
}

function harnessSavedPct(tool: string, latest: any): number | null {
  if (!latest) return null;
  const toolRows = latest.rows.filter((r: any) => r.tool === tool);
  const rawRows = latest.rows.filter((r: any) => r.tool === "raw");
  if (toolRows.length === 0 || rawRows.length === 0) return null;
  const toolBytes = toolRows.reduce((a: number, r: any) => a + r.totalBytes, 0);
  const rawBytes = rawRows.reduce((a: number, r: any) => a + r.totalBytes, 0);
  if (rawBytes === 0) return null;
  return Number(((1 - toolBytes / rawBytes) * 100).toFixed(1));
}

async function main(): Promise<void> {
  mkdirSync(BUILD_DIR, { recursive: true });
  console.log("[self-bench] invoking each tool's native benchmark...");
  const results: SelfBenchResult[] = [];
  results.push(await runSqueezBench());
  results.push(await runLeanCtxBench());

  const latest = latestHarnessResult();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const lines: string[] = [
    "# Tool self-benchmark vs our harness",
    "",
    `Generated ${new Date().toISOString()}.`,
    "",
    "Each tool's own `benchmark` subcommand was invoked; we compare its claim to what our harness measured (latest competitor-baseline-*.json aggregated saved %).",
    "",
    "| Tool | Self-bench available | Tool's claim | Our harness avg | Δ |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    const ours = harnessSavedPct(r.tool, latest);
    const claimed = r.claimedSavedPct;
    const delta = (typeof claimed === "number" && typeof ours === "number") ? `${(claimed - ours).toFixed(1)}pp` : "—";
    lines.push(`| ${r.tool} | ${r.available ? "✓" : "✗ " + (r.reason ?? "")} | ${claimed ?? "—"}% | ${ours ?? "—"}% | ${delta} |`);
  }
  lines.push("");
  lines.push("## Raw self-bench output (truncated)");
  lines.push("");
  for (const r of results) {
    if (!r.raw) continue;
    lines.push(`### ${r.tool}`);
    lines.push("");
    lines.push("```");
    lines.push(r.raw);
    lines.push("```");
    lines.push("");
  }

  const md = join(BUILD_DIR, `self-bench-${ts}.md`);
  const jsonOut = join(BUILD_DIR, `self-bench-${ts}.json`);
  writeFileSync(md, lines.join("\n"));
  writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), results, harnessSavedPct: results.map((r) => ({ tool: r.tool, value: harnessSavedPct(r.tool, latest) })) }, null, 2));
  console.log(`[self-bench] wrote ${md}`);
  console.log(`[self-bench] wrote ${jsonOut}`);
}

main().catch((err) => {
  console.error("self-bench failed:", err);
  process.exit(1);
});
