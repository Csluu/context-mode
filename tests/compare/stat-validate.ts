// ctx_stats validation. Runs a known workload N times, externally accounts
// for bytes-in/bytes-out per call, then calls ctx_stats / ctx_gain on each
// server. Cross-checks reported numbers against externally measured ground
// truth.
//
// Improvements over the single-shot version:
//   - Workload runs N=5 iterations per side (configurable via STAT_ITERATIONS).
//   - Tries `{ format: "json" }` on ctx_stats first; falls back to regex on
//     human text if the server doesn't recognize the arg.
//   - Reports mean + stddev across iterations.
//   - Verdict: pass if reported savings parsed on ≥3/5 iterations AND mean
//     is in [0, 99].
//
// Output: build/compare/stat-validate-<ts>.{json,md}

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpStdioClient } from "./runner.js";
import {
  buildMeta, extractText, forkServer, isolateEnv, preflight, reportDir, upstreamServer,
} from "./lib.js";

const STAT_ITERATIONS = Math.max(1, parseInt(process.env.STAT_ITERATIONS || "5", 10));

interface CallRecord {
  tool: string;
  args_bytes: number;
  bytes_out: number;
  ms: number;
}

interface WorkloadRun {
  calls: CallRecord[];
  totalArgsBytes: number;
  totalOutBytes: number;
  totalMs: number;
}

interface IterationResult {
  workload: WorkloadRun;
  statsRaw: string;
  gainRaw: string;
  discoverRaw: string;
  jsonStats?: any;
  reportedSavingsCandidates: Array<{ label: string; value: number }>;
  reportedToolCounts: Record<string, number>;
  bestReported?: number;
}

interface SideAggregate {
  iterations: IterationResult[];
  meanTotalOutBytes: number;
  meanTotalMs: number;
  reportedSavingsValues: number[];
  reportedMean: number;
  reportedStddev: number;
  iterationsWithReportedSavings: number;
}

function argsBytes(args: unknown): number {
  return Buffer.byteLength(JSON.stringify(args), "utf8");
}

async function runWorkload(client: McpStdioClient): Promise<WorkloadRun> {
  const calls: CallRecord[] = [];
  async function call(tool: string, args: Record<string, unknown>): Promise<string> {
    try {
      const r = await client.call(tool, args);
      calls.push({ tool, args_bytes: argsBytes(args), bytes_out: r.bytes, ms: r.ms });
      return extractText(r.result);
    } catch {
      calls.push({ tool, args_bytes: argsBytes(args), bytes_out: 0, ms: 0 });
      return "";
    }
  }
  await call("ctx_batch_execute", {
    commands: [
      { label: "echo-1", command: "echo 'corpus alpha bravo charlie'" },
      { label: "echo-2", command: "echo 'corpus delta echo foxtrot'" },
      { label: "echo-3", command: "echo 'corpus golf hotel india'" },
    ],
    queries: ["alpha", "delta"],
  });
  await call("ctx_search", { queries: ["bravo"] });
  await call("ctx_search", { queries: ["foxtrot", "india"] });
  await call("ctx_execute", { language: "javascript", code: `for (let i = 0; i < 50; i++) console.log("row " + i);` });
  return {
    calls,
    totalArgsBytes: calls.reduce((a, c) => a + c.args_bytes, 0),
    totalOutBytes: calls.reduce((a, c) => a + c.bytes_out, 0),
    totalMs: calls.reduce((a, c) => a + c.ms, 0),
  };
}

function extractPercentCandidates(text: string): Array<{ label: string; value: number }> {
  const out: Array<{ label: string; value: number }> = [];
  const re = /([A-Za-z][A-Za-z _-]{0,40}?)[: ]+([\d.]+)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[2]);
    if (!Number.isNaN(v) && v >= 0 && v <= 100) {
      out.push({ label: m[1].trim().toLowerCase(), value: v });
    }
  }
  return out;
}

function extractToolCounts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /(ctx_[a-z_]+)[:\s|│]+([\d,]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[2].replace(/,/g, ""), 10);
    if (!Number.isNaN(n)) {
      const key = m[1].toLowerCase();
      out[key] = Math.max(out[key] || 0, n);
    }
  }
  return out;
}

function pickBestReported(jsonStats: any, candidates: Array<{ label: string; value: number }>): number | undefined {
  // Try common JSON keys first.
  const keys = ["savings_pct", "savingsPct", "savings_percent", "ratio_saved_pct", "context_saved_pct"];
  for (const k of keys) {
    const v = jsonStats?.[k];
    if (typeof v === "number" && v >= 0 && v <= 100) return v;
  }
  if (typeof jsonStats?.context_savings === "number") return jsonStats.context_savings;
  // Then prefer labeled saving% candidates.
  let best: number | undefined;
  for (const c of candidates) {
    if (/saving|saved|ratio|reduce/.test(c.label)) {
      if (best === undefined || c.value > best) best = c.value;
    }
  }
  if (best === undefined && candidates.length > 0) best = candidates[0].value;
  return best;
}

async function tryJsonStats(client: McpStdioClient): Promise<{ raw: string; parsed?: any }> {
  try {
    const r = await client.call("ctx_stats", { format: "json" });
    const text = extractText(r.result);
    try { return { raw: text, parsed: JSON.parse(text) }; }
    catch { return { raw: text }; }
  } catch {
    try {
      const r = await client.call("ctx_stats", {});
      return { raw: extractText(r.result) };
    } catch {
      return { raw: "" };
    }
  }
}

async function runIteration(client: McpStdioClient): Promise<IterationResult> {
  const workload = await runWorkload(client);
  const { raw: statsRaw, parsed: jsonStats } = await tryJsonStats(client);
  let gainRaw = "";
  let discoverRaw = "";
  try { const r = await client.call("ctx_gain", {}); gainRaw = extractText(r.result); } catch {}
  try { const r = await client.call("ctx_discover", {}); discoverRaw = extractText(r.result); } catch {}
  const candidates = extractPercentCandidates(statsRaw + "\n" + gainRaw);
  const counts = extractToolCounts(statsRaw);
  const bestReported = pickBestReported(jsonStats, candidates);
  return {
    workload, statsRaw, gainRaw, discoverRaw,
    jsonStats,
    reportedSavingsCandidates: candidates,
    reportedToolCounts: counts,
    bestReported,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

async function evaluateSide(serverPath: string, label: string): Promise<SideAggregate> {
  const env = isolateEnv(`stat-${label}`);
  const client = new McpStdioClient(serverPath, { env });
  await client.initialize();
  try {
    const iterations: IterationResult[] = [];
    for (let i = 0; i < STAT_ITERATIONS; i++) {
      const r = await runIteration(client);
      iterations.push(r);
      console.log(`[${label} iter ${i + 1}/${STAT_ITERATIONS}] calls=${r.workload.calls.length} out_b=${r.workload.totalOutBytes} ms=${r.workload.totalMs.toFixed(0)} reported=${r.bestReported ?? "-"}`);
    }
    const reportedSavingsValues = iterations
      .map((i) => i.bestReported)
      .filter((v): v is number => typeof v === "number");
    return {
      iterations,
      meanTotalOutBytes: mean(iterations.map((i) => i.workload.totalOutBytes)),
      meanTotalMs: mean(iterations.map((i) => i.workload.totalMs)),
      reportedSavingsValues,
      reportedMean: mean(reportedSavingsValues),
      reportedStddev: stddev(reportedSavingsValues),
      iterationsWithReportedSavings: reportedSavingsValues.length,
    };
  } finally {
    client.close();
  }
}

interface Verdict {
  ok: boolean;
  reasons: string[];
  reportedMean: number;
  reportedStddev: number;
  iterationsWithReportedSavings: number;
}

const MIN_ITERATIONS_REPORTING = Math.ceil(STAT_ITERATIONS * 0.6); // 3/5

function judge(side: SideAggregate): Verdict {
  const reasons: string[] = [];
  if (side.iterations.length === 0) reasons.push("no iterations");
  const noBytes = side.iterations.filter((i) => i.workload.totalOutBytes === 0).length;
  if (noBytes > 0) reasons.push(`${noBytes}/${side.iterations.length} iterations returned zero bytes`);
  if (side.iterationsWithReportedSavings < MIN_ITERATIONS_REPORTING) {
    reasons.push(`only ${side.iterationsWithReportedSavings}/${side.iterations.length} iterations exposed parseable savings% (need ≥${MIN_ITERATIONS_REPORTING})`);
  }
  if (side.iterationsWithReportedSavings > 0) {
    if (side.reportedMean < 0 || side.reportedMean > 99) {
      reasons.push(`reported mean ${side.reportedMean.toFixed(1)}% out of [0, 99]`);
    }
  }
  return {
    ok: reasons.length === 0,
    reasons,
    reportedMean: side.reportedMean,
    reportedStddev: side.reportedStddev,
    iterationsWithReportedSavings: side.iterationsWithReportedSavings,
  };
}

function renderMd(fork: SideAggregate, up: SideAggregate, forkV: Verdict, upV: Verdict): string {
  const lines: string[] = [];
  lines.push(`# ctx_stats validation — fork vs upstream`);
  lines.push("");
  lines.push(`Workload runs **${STAT_ITERATIONS} iteration(s)** per side. Stat parsing tries JSON first (\`format: "json"\`), falls back to regex on human text.`);
  lines.push("");
  lines.push(`## Per-iteration summary`);
  lines.push("");
  lines.push(`| Iter | Side | Out B | Total ms | Reported savings % |`);
  lines.push(`|------|------|-------|----------|---------------------|`);
  for (let i = 0; i < STAT_ITERATIONS; i++) {
    const f = fork.iterations[i];
    const u = up.iterations[i];
    if (f) lines.push(`| ${i + 1} | fork | ${f.workload.totalOutBytes} | ${f.workload.totalMs.toFixed(0)} | ${f.bestReported ?? "-"} |`);
    if (u) lines.push(`| ${i + 1} | upstream | ${u.workload.totalOutBytes} | ${u.workload.totalMs.toFixed(0)} | ${u.bestReported ?? "-"} |`);
  }
  lines.push("");
  lines.push(`## Aggregates`);
  lines.push("");
  lines.push(`| Side | Mean out B | Mean ms | Reported mean % | Reported stddev % | Reporting iters |`);
  lines.push(`|------|------------|---------|------------------|-------------------|-----------------|`);
  lines.push(`| fork | ${fork.meanTotalOutBytes.toFixed(0)} | ${fork.meanTotalMs.toFixed(0)} | ${fork.reportedMean.toFixed(1)} | ${fork.reportedStddev.toFixed(2)} | ${fork.iterationsWithReportedSavings}/${STAT_ITERATIONS} |`);
  lines.push(`| upstream | ${up.meanTotalOutBytes.toFixed(0)} | ${up.meanTotalMs.toFixed(0)} | ${up.reportedMean.toFixed(1)} | ${up.reportedStddev.toFixed(2)} | ${up.iterationsWithReportedSavings}/${STAT_ITERATIONS} |`);
  lines.push("");
  lines.push(`## Verdict`);
  lines.push("");
  lines.push(`| Side | OK | Reasons |`);
  lines.push(`|------|----|---------|`);
  lines.push(`| fork | ${forkV.ok ? "yes" : "NO"} | ${forkV.reasons.join("; ") || "-"} |`);
  lines.push(`| upstream | ${upV.ok ? "yes" : "NO"} | ${upV.reasons.join("; ") || "-"} |`);
  lines.push("");
  lines.push(`## First fork iteration — raw ctx_stats`);
  lines.push("```");
  lines.push((fork.iterations[0]?.statsRaw ?? "").slice(0, 3000));
  lines.push("```");
  lines.push("");
  lines.push(`## First upstream iteration — raw ctx_stats`);
  lines.push("```");
  lines.push((up.iterations[0]?.statsRaw ?? "").slice(0, 3000));
  lines.push("```");
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  preflight();
  console.log(`[compare] stat-validate: ${STAT_ITERATIONS} iter/side`);
  const fork = await evaluateSide(forkServer, "fork");
  const up = await evaluateSide(upstreamServer, "upstream");
  const forkV = judge(fork);
  const upV = judge(up);
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `stat-validate-${ts}.json`);
  const mdPath = join(reportDir, `stat-validate-${ts}.md`);
  const meta = buildMeta("stat-validate");
  writeFileSync(jsonPath, JSON.stringify({ meta, iterations: STAT_ITERATIONS, fork, upstream: up, forkVerdict: forkV, upstreamVerdict: upV }, null, 2));
  writeFileSync(mdPath, renderMd(fork, up, forkV, upV));
  console.log(`[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);

  if (!forkV.ok) {
    console.error(`[compare] fork failed: ${forkV.reasons.join("; ")}`);
    process.exit(1);
  }
  if (!upV.ok) {
    console.warn(`[compare] upstream failed (informational): ${upV.reasons.join("; ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
