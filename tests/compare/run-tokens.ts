// Token accounting aggregator. Scans build/compare/*.json (latest per type:
// per-tool, workflows, stat-validate) and produces a unified per-tool /
// per-category / per-displaced-native token breakdown for fork and upstream.
//
// Assumes you've already run `npm run compare:full` so the JSON reports
// exist. If a category of report is missing, that section is skipped.
//
// Token estimate: bytes / CHARS_PER_TOKEN (default 4). Override via
//   CHARS_PER_TOKEN=3.5 npm run compare:tokens

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildMeta, reportDir } from "./lib.js";
import {
  CHARS_PER_TOKEN, categorize, emptyBuckets, record, totals,
  type AggregateBuckets, type TokenObservation,
} from "./token-accounting.js";

interface SidePair {
  fork: AggregateBuckets;
  upstream: AggregateBuckets;
  serena: AggregateBuckets;
}

interface RawBaselineRow {
  tool: string;
  scenario: string;
  rawEquivalent: string;
  rawBytes: number;
  rawTokens: number;
}

export interface SerenaBaselineRow {
  tool: string;
  scenario: string;
  serenaTool: string | null;
  applicable: boolean;
  bytes: number;
  tokens: number;
  ms: number;
  ok: boolean;
  reason?: string;
}

interface WorkflowRawStepRow {
  label: string;
  tool: string;
  rawEquivalent: string;
  rawBytes: number;
  rawTokens: number;
}

interface WorkflowRawRow {
  workflow: string;
  steps: WorkflowRawStepRow[];
  totalBytes: number;
  totalTokens: number;
}

export interface ScenarioSavingsRow {
  tool: string;
  scenario: string;
  rawBytes: number;
  rawTokens: number;
  forkBytes: number;
  forkTokens: number;
  upBytes: number | null;
  upTokens: number | null;
  /** Bytes upstream user would see in a REAL session: upstream's own bytes
   *  if the tool exists, else raw native fallback (Read/Bash/etc.). */
  upWithFallbackBytes: number;
  upWithFallbackTokens: number;
  /** Was native fallback used? true when upstream lacks the tool. */
  usedFallback: boolean;
  /** Serena's own bytes (null if Serena has no equivalent or no baseline). */
  serenaBytes: number | null;
  serenaTokens: number | null;
  /** Serena + native fallback for the scenarios Serena can't handle. */
  serenaWithFallbackBytes: number | null;
  serenaWithFallbackTokens: number | null;
  serenaUsedFallback: boolean;
  /** Real-session bytes for a user with BOTH upstream + Serena installed:
   *  upstream tool if upstream has it, else Serena if applicable, else native fallback. */
  upstreamPlusSerenaBytes: number | null;
  upstreamPlusSerenaTokens: number | null;
  /** Real-session bytes for a user with BOTH fork + Serena: pick whichever
   *  returns the smaller payload (fork always wins-or-ties unless Serena
   *  applicable AND smaller). */
  forkPlusSerenaBytes: number | null;
  forkPlusSerenaTokens: number | null;
  forkSavingsPct: number;
  upSavingsPct: number | null;
  upWithFallbackSavingsPct: number;
  serenaSavingsPct: number | null;
  serenaWithFallbackSavingsPct: number | null;
  upstreamPlusSerenaSavingsPct: number | null;
  forkPlusSerenaSavingsPct: number | null;
  forkVsUpDelta: number | null;
}

function isCodeNavigationSerenaLane(row: Pick<SerenaBaselineRow, "tool" | "scenario" | "serenaTool">): boolean {
  const workflow = row.tool.startsWith("workflow:") ? row.tool.slice("workflow:".length) : "";
  const scenario = row.scenario;
  if (/slice|grep|extract|diff|fetch|route|execute|sidecar|stats|gain|discover|doctor/i.test(scenario)) return false;
  if (/bundle|json|md|markdown|frontmatter|binary|unicode|log|network|sidecar|diff|route|sandbox|cache/i.test(workflow)) return false;
  if (row.tool === "ctx_read") return /map|outline|symbols/.test(scenario);
  if (!row.tool.startsWith("workflow:")) return false;
  if (!/^(get_symbols_overview|find_symbol|find_referencing_symbols)$/.test(row.serenaTool ?? "")) return false;
  return /map|outline|symbols?|find|search|refs|read|warm|semantic|nav/i.test(scenario);
}

export function isSerenaSemanticallyUsable(row: SerenaBaselineRow): boolean {
  return row.applicable === true && row.ok === true && isCodeNavigationSerenaLane(row);
}

function pickLatest(prefix: string): string | null {
  if (!existsSync(reportDir)) return null;
  const files = readdirSync(reportDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
  return files.length > 0 ? join(reportDir, files[files.length - 1]) : null;
}

function loadRawBaseline(): Map<string, RawBaselineRow> {
  const path = pickLatest("raw-baseline-");
  const out = new Map<string, RawBaselineRow>();
  if (!path) return out;
  const data = safeJson(path);
  if (!Array.isArray(data?.rows)) return out;
  for (const r of data.rows) {
    out.set(`${r.tool}::${r.scenario}`, r);
  }
  return out;
}

function loadWorkflowRaw(): Map<string, number> {
  // Key: "workflow::label" → raw bytes
  const path = pickLatest("workflow-raw-baseline-");
  const out = new Map<string, number>();
  if (!path) return out;
  const data = safeJson(path);
  if (!Array.isArray(data?.rows)) return out;
  for (const wf of data.rows as WorkflowRawRow[]) {
    for (const s of wf.steps) {
      out.set(`${wf.workflow}::${s.label}`, s.rawBytes);
    }
  }
  return out;
}

function loadSerenaBaseline(): Map<string, SerenaBaselineRow> {
  const path = pickLatest("serena-baseline-");
  const out = new Map<string, SerenaBaselineRow>();
  if (!path) return out;
  const data = safeJson(path);
  if (!Array.isArray(data?.rows)) return out;
  for (const r of data.rows) {
    out.set(`${r.tool}::${r.scenario}`, r);
  }
  return out;
}

function ingestSerenaBaseline(buckets: SidePair, serena: Map<string, SerenaBaselineRow>): void {
  for (const r of serena.values()) {
    if (!isSerenaSemanticallyUsable(r)) continue;
    // Direct tool match: ctx_read scenarios contribute to ctx_read bucket.
    // Workflow scenarios (tool="workflow:<name>") contribute to a "serena:<name>"
    // synthetic tool so we can compute per-workflow Serena totals without
    // polluting the ctx_read row with workflow data.
    const tool = r.tool.startsWith("workflow:") ? "serena_symbol_overview" : r.tool;
    record(buckets.serena, tool, 0, r.bytes, 1);
  }
}

export function buildScenarioSavings(
  perToolFiles: string[],
  raw: Map<string, RawBaselineRow>,
  serena: Map<string, SerenaBaselineRow>,
): ScenarioSavingsRow[] {
  const rows: ScenarioSavingsRow[] = [];
  for (const file of perToolFiles) {
    const data = safeJson(file);
    if (!Array.isArray(data?.rows)) continue;
    for (const r of data.rows) {
      const key = `${r.tool}::${r.scenario}`;
      const rawRow = raw.get(key);
      if (!rawRow) continue;
      const forkBytes = Number(r.fork?.bytes?.median) || 0;
      const upBytes = Number(r.upstream?.bytes?.median) || 0;
      const upOk = Number(r.upstream?.successes) > 0;
      const forkSavingsPct = rawRow.rawBytes === 0 ? 0 : (1 - forkBytes / rawRow.rawBytes) * 100;
      const upSavingsPct = upOk && rawRow.rawBytes > 0 ? (1 - upBytes / rawRow.rawBytes) * 100 : null;
      const forkVsUpDelta = upOk && upBytes > 0 ? ((forkBytes - upBytes) / upBytes) * 100 : null;
      // Real-session fallback: if upstream lacks the tool (e.g. ctx_read on
      // v1.0.143), the user falls back to native Read / Bash / curl which
      // returns the raw payload.
      const upWithFallbackBytes = upOk ? upBytes : rawRow.rawBytes;
      const upWithFallbackSavingsPct = rawRow.rawBytes === 0 ? 0 : (1 - upWithFallbackBytes / rawRow.rawBytes) * 100;

      // Serena: only counts when applicable + ok; otherwise fallback to raw.
      const sRow = serena.get(key);
      const sUsable = !!sRow && isSerenaSemanticallyUsable(sRow);
      const serenaBytes = sUsable ? sRow!.bytes : null;
      const serenaSavingsPct = sUsable && rawRow.rawBytes > 0 ? (1 - sRow!.bytes / rawRow.rawBytes) * 100 : null;
      const serenaUsedFallback = !sUsable;
      const serenaWithFallbackBytes = sUsable ? sRow!.bytes : rawRow.rawBytes;
      const serenaWithFallbackSavingsPct = rawRow.rawBytes === 0 ? 0 : (1 - serenaWithFallbackBytes / rawRow.rawBytes) * 100;

      // Composite stacks: pick best available tool per scenario.
      // upstream+serena: prefer upstream if it has the tool, else Serena, else raw.
      const upPlusSerenaBytes = upOk
        ? upBytes
        : (sUsable ? sRow!.bytes : rawRow.rawBytes);
      const upPlusSerenaSavingsPct = rawRow.rawBytes === 0 ? 0 : (1 - upPlusSerenaBytes / rawRow.rawBytes) * 100;
      // fork+serena: fork always has the tool, pick whichever is smaller.
      const forkPlusSerenaBytes = sUsable
        ? Math.min(forkBytes, sRow!.bytes)
        : forkBytes;
      const forkPlusSerenaSavingsPct = rawRow.rawBytes === 0 ? 0 : (1 - forkPlusSerenaBytes / rawRow.rawBytes) * 100;

      rows.push({
        tool: r.tool, scenario: r.scenario,
        rawBytes: rawRow.rawBytes,
        rawTokens: rawRow.rawTokens,
        forkBytes,
        forkTokens: Math.round(forkBytes / 4),
        upBytes: upOk ? upBytes : null,
        upTokens: upOk ? Math.round(upBytes / 4) : null,
        upWithFallbackBytes,
        upWithFallbackTokens: Math.round(upWithFallbackBytes / 4),
        usedFallback: !upOk,
        serenaBytes,
        serenaTokens: serenaBytes !== null ? Math.round(serenaBytes / 4) : null,
        serenaWithFallbackBytes: serena.size > 0 ? serenaWithFallbackBytes : null,
        serenaWithFallbackTokens: serena.size > 0 ? Math.round(serenaWithFallbackBytes / 4) : null,
        serenaUsedFallback,
        upstreamPlusSerenaBytes: serena.size > 0 ? upPlusSerenaBytes : null,
        upstreamPlusSerenaTokens: serena.size > 0 ? Math.round(upPlusSerenaBytes / 4) : null,
        forkPlusSerenaBytes: serena.size > 0 ? forkPlusSerenaBytes : null,
        forkPlusSerenaTokens: serena.size > 0 ? Math.round(forkPlusSerenaBytes / 4) : null,
        forkSavingsPct,
        upSavingsPct,
        upWithFallbackSavingsPct,
        serenaSavingsPct,
        serenaWithFallbackSavingsPct: serena.size > 0 ? serenaWithFallbackSavingsPct : null,
        upstreamPlusSerenaSavingsPct: serena.size > 0 ? upPlusSerenaSavingsPct : null,
        forkPlusSerenaSavingsPct: serena.size > 0 ? forkPlusSerenaSavingsPct : null,
        forkVsUpDelta,
      });
    }
  }
  return rows;
}

function safeJson(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e: any) { console.error(`[compare] failed to parse ${path}: ${e.message}`); return null; }
}

function ingestToolReport(buckets: SidePair, data: any): void {
  if (!Array.isArray(data?.rows)) return;
  for (const r of data.rows) {
    const iters = Number(r.iterations) || 1;
    const argsBytes = Number(r.argsBytes) || 0;
    const tool = String(r.tool);
    const forkOutMed = Number(r.fork?.bytes?.median) || 0;
    const upOutMed = Number(r.upstream?.bytes?.median) || 0;
    const forkSucc = Number(r.fork?.successes) || 0;
    const upSucc = Number(r.upstream?.successes) || 0;
    // Total cost ≈ argsBytes per invocation × invocations + median outBytes × successes.
    record(buckets.fork, tool, argsBytes * iters, forkOutMed * forkSucc, iters);
    if (upSucc > 0) record(buckets.upstream, tool, argsBytes * iters, upOutMed * upSucc, iters);
  }
}

function ingestWorkflowReport(buckets: SidePair, data: any): void {
  if (!Array.isArray(data?.rows)) return;
  for (const wf of data.rows) {
    const forkSteps = Array.isArray(wf.fork?.steps) ? wf.fork.steps : [];
    const upSteps = Array.isArray(wf.upstream?.steps) ? wf.upstream.steps : [];
    for (const s of forkSteps) {
      record(buckets.fork, String(s.tool), Number(s.argsBytes) || 0, Number(s.bytes) || 0, 1);
    }
    for (const s of upSteps) {
      record(buckets.upstream, String(s.tool), Number(s.argsBytes) || 0, Number(s.bytes) || 0, 1);
    }
  }
}

function ingestStatValidateReport(buckets: SidePair, data: any): void {
  const fork = data?.fork;
  const up = data?.upstream;
  for (const side of [["fork", fork], ["upstream", up]] as const) {
    const [name, agg] = side;
    if (!agg || !Array.isArray(agg.iterations)) continue;
    const targetBuckets = name === "fork" ? buckets.fork : buckets.upstream;
    for (const it of agg.iterations) {
      const calls = Array.isArray(it.workload?.calls) ? it.workload.calls : [];
      for (const c of calls) {
        record(targetBuckets, String(c.tool), Number(c.args_bytes) || 0, Number(c.bytes_out) || 0, 1);
      }
      // Also account for ctx_stats/ctx_gain/ctx_discover calls that produced
      // the raw text (input args ~empty, output = byte length of the raw).
      const statsBytes = Buffer.byteLength(String(it.statsRaw || ""), "utf8");
      const gainBytes = Buffer.byteLength(String(it.gainRaw || ""), "utf8");
      const discBytes = Buffer.byteLength(String(it.discoverRaw || ""), "utf8");
      if (statsBytes > 0) record(targetBuckets, "ctx_stats", 2, statsBytes, 1);
      if (gainBytes > 0) record(targetBuckets, "ctx_gain", 2, gainBytes, 1);
      if (discBytes > 0) record(targetBuckets, "ctx_discover", 2, discBytes, 1);
    }
  }
}

function sortByOutputDesc(map: Map<string, TokenObservation>): Array<[string, TokenObservation]> {
  return [...map.entries()].sort((a, b) => b[1].outputTokens - a[1].outputTokens);
}

export function renderWorkflowBreakout(
  workflowsData: any,
  serena: Map<string, SerenaBaselineRow>,
  workflowRaw: Map<string, number>,
): string {
  if (!workflowsData || !Array.isArray(workflowsData.rows) || workflowsData.rows.length === 0) return "";
  const hasRaw = workflowRaw.size > 0;
  const lines: string[] = [];
  lines.push(`## Workflow per-step breakout (Raw / Fork / Up+fb / Serena / Up+Serena / Fork+Serena)`);
  lines.push("");
  lines.push(`Each workflow runs as a fixed chain of steps. Bytes-out per step.`);
  lines.push(`Composite columns:`);
  lines.push(`- \`Raw B\` = native equivalent (cat / git / node -e / curl / grep) — what hits context with NO MCP help${hasRaw ? "" : " — _missing, run `npm run compare:workflow-raw`_"}`);
  lines.push(`- \`Up+fb B\` = upstream bytes if upstream step ok, else **raw fallback** bytes (concrete)`);
  lines.push(`- \`Up+Serena B\` = upstream if ok, else Serena only when semantically applicable, else raw fallback`);
  lines.push(`- \`Fork+Serena B\` = min(fork bytes, Serena bytes) only when Serena is semantically applicable; otherwise fork bytes`);
  lines.push("");
  let grandRaw = 0;
  let grandUpFb = 0;
  let grandFork = 0;
  let grandUpSerena = 0;
  let grandForkSerena = 0;
  let qualityRaw = 0;
  let qualityFork = 0;
  let qualityUpFb = 0;
  let qualityUpSerena = 0;
  let qualityForkSerena = 0;
  let qualitySteps = 0;
  let totalSteps = 0;
  let excludedFailed = 0;
  let excludedOracleFailed = 0;
  let excludedNoOracle = 0;
  let excludedRaw = 0;
  let excludedFork = 0;
  for (const wf of workflowsData.rows) {
    const wfName = String(wf.workflow || "(unknown)");
    const forkSteps: any[] = Array.isArray(wf.fork?.steps) ? wf.fork.steps : [];
    const upSteps: any[] = Array.isArray(wf.upstream?.steps) ? wf.upstream.steps : [];
    if (forkSteps.length === 0) continue;
    let wfRawTotal = 0;
    let wfForkTotal = 0;
    let wfUpFbTotal = 0;
    let wfUpSerenaTotal = 0;
    let wfForkSerenaTotal = 0;
    let upFallbacks = 0;
    let upSerenaFallbacks = 0;

    lines.push(`### ${wfName}`);
    if (wf.description) lines.push(`_${wf.description}_`);
    lines.push("");
    lines.push(`| # | Step | Tool | Raw B | Fork B | Up+fb B | Serena B | Up+Serena B | Fork+Serena B |`);
    lines.push(`|---|------|------|-------|--------|---------|----------|-------------|---------------|`);
    for (let i = 0; i < forkSteps.length; i++) {
      const fs = forkSteps[i];
      const us = upSteps[i];
      totalSteps++;
      const sKey = `workflow:${wfName}::${fs.label}`;
      const sRow = serena.get(sKey);
      const sUsable = !!sRow && isSerenaSemanticallyUsable(sRow);
      const rawKey = `${wfName}::${fs.label}`;
      const rawB = workflowRaw.get(rawKey) ?? 0;

      const forkB = Number(fs.bytes) || 0;
      const upOk = us && us.ok !== false;
      const upB = upOk ? (Number(us.bytes) || 0) : null;
      const sB = sUsable ? sRow!.bytes : null;

      // composites with concrete raw fallback
      const upFbB = upOk ? upB! : rawB;
      const upFbCell = upOk ? String(upB) : `${rawB} (fb)`;
      if (!upOk) upFallbacks++;

      let upSerenaCell: string;
      let upSerenaVal: number;
      if (upOk) { upSerenaCell = String(upB); upSerenaVal = upB!; }
      else if (sUsable) { upSerenaCell = `${sB} (serena)`; upSerenaVal = sB!; }
      else { upSerenaCell = `${rawB} (fb)`; upSerenaVal = rawB; upSerenaFallbacks++; }

      const fsB = sUsable ? Math.min(forkB, sRow!.bytes) : forkB;
      const fsCell = sUsable && fsB < forkB ? `${fsB} (serena)` : String(fsB);

      wfRawTotal += rawB;
      wfForkTotal += forkB;
      wfUpFbTotal += upFbB;
      wfUpSerenaTotal += upSerenaVal;
      wfForkSerenaTotal += fsB;

      if (fs.ok === true && fs.oracleOk === true) {
        qualitySteps++;
        qualityRaw += rawB;
        qualityFork += forkB;
        qualityUpFb += upFbB;
        qualityUpSerena += upSerenaVal;
        qualityForkSerena += fsB;
      } else {
        excludedRaw += rawB;
        excludedFork += forkB;
        if (fs.ok === false) excludedFailed++;
        else if (fs.hasOracle && fs.oracleOk === false) excludedOracleFailed++;
        else excludedNoOracle++;
      }

      lines.push(`| ${i + 1} | ${fs.label} | ${fs.tool} | ${rawB} | ${forkB} | ${upFbCell} | ${sB ?? "n/a"} | ${upSerenaCell} | ${fsCell} |`);
    }
    lines.push("");
    const pctV = (b: number) => wfRawTotal === 0 ? "n/a" : `${((1 - b / wfRawTotal) * 100).toFixed(1)}%`;
    lines.push(`**${wfName} totals:** Raw=${wfRawTotal} B / ${Math.round(wfRawTotal / CHARS_PER_TOKEN)} tok · Fork=${wfForkTotal} B (saved ${pctV(wfForkTotal)}) · Up+fb=${wfUpFbTotal} B (saved ${pctV(wfUpFbTotal)}, ${upFallbacks} fb step(s)) · Up+Serena=${wfUpSerenaTotal} B (saved ${pctV(wfUpSerenaTotal)}, ${upSerenaFallbacks} fb step(s)) · Fork+Serena=${wfForkSerenaTotal} B (saved ${pctV(wfForkSerenaTotal)})`);
    lines.push("");
    grandRaw += wfRawTotal;
    grandFork += wfForkTotal;
    grandUpFb += wfUpFbTotal;
    grandUpSerena += wfUpSerenaTotal;
    grandForkSerena += wfForkSerenaTotal;
  }
  if (grandRaw > 0) {
    const pctG = (b: number) => grandRaw === 0 ? "n/a" : ((1 - b / grandRaw) * 100).toFixed(1);
    const pctQ = (b: number) => qualityRaw === 0 ? "n/a" : ((1 - b / qualityRaw) * 100).toFixed(1);
    lines.push(`### Workflow aggregate (quality-adjusted)`);
    lines.push("");
    lines.push(`Only fork steps with \`ok === true\` and \`oracleOk === true\` contribute to this savings claim. Failed/refusal/oracle-failed steps are excluded instead of counted as wins.`);
    lines.push("");
    lines.push(`| Side | Steps | Bytes | Tokens | Saved % vs raw |`);
    lines.push(`|------|-------|-------|--------|----------------|`);
    lines.push(`| Raw native | ${qualitySteps}/${totalSteps} | ${qualityRaw} | ${Math.round(qualityRaw / CHARS_PER_TOKEN)} | — |`);
    lines.push(`| Upstream + raw fallback | ${qualitySteps}/${totalSteps} | ${qualityUpFb} | ${Math.round(qualityUpFb / CHARS_PER_TOKEN)} | **${pctQ(qualityUpFb)}** |`);
    lines.push(`| Fork | ${qualitySteps}/${totalSteps} | ${qualityFork} | ${Math.round(qualityFork / CHARS_PER_TOKEN)} | **${pctQ(qualityFork)}** |`);
    lines.push(`| Upstream + Serena (+ raw fb) | ${qualitySteps}/${totalSteps} | ${qualityUpSerena} | ${Math.round(qualityUpSerena / CHARS_PER_TOKEN)} | **${pctQ(qualityUpSerena)}** |`);
    lines.push(`| Fork + Serena | ${qualitySteps}/${totalSteps} | ${qualityForkSerena} | ${Math.round(qualityForkSerena / CHARS_PER_TOKEN)} | **${pctQ(qualityForkSerena)}** |`);
    lines.push("");
    lines.push(`Excluded from quality-adjusted savings: failed/refusal=${excludedFailed}, oracle-failed=${excludedOracleFailed}, no-oracle=${excludedNoOracle}, raw=${excludedRaw} B, fork=${excludedFork} B.`);
    lines.push("");
    lines.push(`### Workflow aggregate (all observed payload bytes, not quality-adjusted)`);
    lines.push("");
    lines.push(`| Side | Bytes | Tokens | Saved % vs raw |`);
    lines.push(`|------|-------|--------|----------------|`);
    lines.push(`| Raw native | ${grandRaw} | ${Math.round(grandRaw / CHARS_PER_TOKEN)} | — |`);
    lines.push(`| Upstream + raw fallback | ${grandUpFb} | ${Math.round(grandUpFb / CHARS_PER_TOKEN)} | **${pctG(grandUpFb)}** |`);
    lines.push(`| Fork | ${grandFork} | ${Math.round(grandFork / CHARS_PER_TOKEN)} | **${pctG(grandFork)}** |`);
    lines.push(`| Upstream + Serena (+ raw fb) | ${grandUpSerena} | ${Math.round(grandUpSerena / CHARS_PER_TOKEN)} | **${pctG(grandUpSerena)}** |`);
    lines.push(`| Fork + Serena | ${grandForkSerena} | ${Math.round(grandForkSerena / CHARS_PER_TOKEN)} | **${pctG(grandForkSerena)}** |`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderNonRawScenarios(perToolFiles: string[], raw: Map<string, RawBaselineRow>, serena: Map<string, SerenaBaselineRow>): string {
  const lines: string[] = [];
  const rows: Array<{ tool: string; scenario: string; forkBytes: number; upBytes: number | null; serenaBytes: number | null }> = [];
  let invalidRows = 0;
  for (const file of perToolFiles) {
    const data = safeJson(file);
    if (!Array.isArray(data?.rows)) continue;
    for (const r of data.rows) {
      if (typeof r?.workflow === "string") continue;
      if (r?.tool === undefined && r?.scenario === undefined) continue;
      if (typeof r?.tool !== "string" || typeof r?.scenario !== "string" || !r.tool.trim() || !r.scenario.trim() || r.scenario === "undefined") {
        invalidRows++;
        continue;
      }
      const key = `${r.tool}::${r.scenario}`;
      if (raw.has(key)) continue; // covered by main savings table
      const forkBytes = Number(r.fork?.bytes?.median) || 0;
      const upOk = Number(r.upstream?.successes) > 0;
      const upBytes = upOk ? (Number(r.upstream?.bytes?.median) || 0) : null;
      const sRow = serena.get(key);
      const sUsable = !!sRow && isSerenaSemanticallyUsable(sRow);
      rows.push({ tool: r.tool, scenario: r.scenario, forkBytes, upBytes, serenaBytes: sUsable ? sRow!.bytes : null });
    }
  }
  if (rows.length === 0) return "";
  lines.push(`## Scenarios without a raw native equivalent`);
  lines.push("");
  lines.push(`These suites measure tools that have no equivalent native operation (ctx_route classifies commands, ctx_stats reports metrics, value-* asserts parser behavior, etc.). No raw-baseline column — savings % vs raw cannot be computed. Listed here for completeness so per-tool calls are not hidden.`);
  lines.push("");
  lines.push(`| Tool | Scenario | Fork B | Up B | Serena B |`);
  lines.push(`|------|----------|--------|------|----------|`);
  for (const r of rows) {
    lines.push(`| ${r.tool} | ${r.scenario} | ${r.forkBytes} | ${r.upBytes ?? "n/a"} | ${r.serenaBytes ?? "n/a"} |`);
  }
  lines.push("");
  lines.push(`**Total scenarios w/o raw equivalent:** ${rows.length}`);
  if (invalidRows > 0) {
    lines.push(`**Invalid rows filtered:** ${invalidRows}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderTable(title: string, rows: Array<[string, TokenObservation]>, upMap: Map<string, TokenObservation>, serenaMap: Map<string, TokenObservation>, header: string): string {
  const lines: string[] = [];
  lines.push(`### ${title}`);
  lines.push("");
  lines.push(`| ${header} | Calls (fork) | Out tok (fork) | Total (fork) | Calls (up) | Out tok (up) | Total (up) | Calls (serena) | Out tok (serena) | Total (serena) | Δ fork-vs-up |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  // Build union of keys so Serena-only tools (e.g. serena_symbol_overview)
  // surface even when fork/upstream don't have them.
  const keys = new Set(rows.map(([k]) => k));
  for (const k of serenaMap.keys()) keys.add(k);
  const allRows: Array<[string, TokenObservation]> = [...keys].map((k) => {
    const fk = rows.find(([rk]) => rk === k)?.[1];
    return [k, fk ?? { tool: k, invocations: 0, inputBytes: 0, outputBytes: 0, inputTokens: 0, outputTokens: 0 }] as [string, TokenObservation];
  });
  allRows.sort((a, b) => (b[1].outputTokens + b[1].inputTokens) - (a[1].outputTokens + a[1].inputTokens));
  for (const [key, fk] of allRows) {
    const up = upMap.get(key);
    const sr = serenaMap.get(key);
    const upTotal = (up?.inputTokens ?? 0) + (up?.outputTokens ?? 0);
    const fkTotal = fk.inputTokens + fk.outputTokens;
    const srTotal = (sr?.inputTokens ?? 0) + (sr?.outputTokens ?? 0);
    const delta = upTotal === 0 ? "n/a" : `${(((fkTotal - upTotal) / upTotal) * 100).toFixed(1)}%`;
    lines.push(
      `| ${key} | ${fk.invocations} | ${fk.outputTokens} | ${fkTotal} | ${up?.invocations ?? 0} | ${up?.outputTokens ?? 0} | ${upTotal} | ${sr?.invocations ?? 0} | ${sr?.outputTokens ?? 0} | ${srTotal} | ${delta} |`,
    );
  }
  return lines.join("\n");
}

function renderSavingsMd(rows: ScenarioSavingsRow[]): string {
  if (rows.length === 0) return "";
  const hasSerena = rows.some((r) => r.upstreamPlusSerenaBytes !== null);
  const lines: string[] = [];
  lines.push(`## Savings vs raw native tools`);
  lines.push("");
  lines.push(`Each row compares the median output bytes of a tool call against the bytes the equivalent raw native operation (cat / node -e / curl / grep / etc.) would have dumped into Claude's context.`);
  lines.push("");
  lines.push(`**Columns (bytes-out per call, B = bytes, T = tokens = B/${CHARS_PER_TOKEN}):**`);
  lines.push(`- \`Raw\` = native operation (cat / node -e / curl / grep) — what hits context with NO MCP help`);
  lines.push(`- \`Up+fb\` = upstream context-mode MCP if scenario's tool exists upstream, else native fallback (raw)`);
  lines.push(`- \`Fork\` = this repo's context-mode fork — covers every scenario natively`);
  lines.push(`- \`Up+Serena\` = upstream + Serena MCP composite: upstream if it has the tool, else Serena only when semantically applicable, else native fallback`);
  lines.push(`- \`Fork+Serena\` = fork + Serena composite: smaller payload only when Serena is semantically applicable for the same task`);
  lines.push("");

  // Per-scenario 5-way table
  lines.push(`### Per-scenario breakout`);
  lines.push("");
  lines.push(`| Tool | Scenario | Raw B | Raw T | Up+fb B | Up+fb T | Fork B | Fork T | Up+Serena B | Up+Serena T | Fork+Serena B | Fork+Serena T |`);
  lines.push(`|------|----------|-------|-------|---------|---------|--------|--------|-------------|-------------|---------------|---------------|`);
  for (const r of rows) {
    const cell = (b: number | null): [string, string] => b === null ? ["n/a", "n/a"] : [String(b), String(Math.round(b / CHARS_PER_TOKEN))];
    const [rawB, rawT] = cell(r.rawBytes);
    const [upfbB, upfbT] = cell(r.upWithFallbackBytes);
    const [forkB, forkT] = cell(r.forkBytes);
    const [upsB, upsT] = cell(r.upstreamPlusSerenaBytes);
    const [fsB, fsT] = cell(r.forkPlusSerenaBytes);
    lines.push(`| ${r.tool} | ${r.scenario} | ${rawB} | ${rawT} | ${upfbB} | ${upfbT} | ${forkB} | ${forkT} | ${upsB} | ${upsT} | ${fsB} | ${fsT} |`);
  }
  lines.push("");

  // Aggregate totals
  const totRaw = rows.reduce((a, r) => a + r.rawBytes, 0);
  const totUpFb = rows.reduce((a, r) => a + r.upWithFallbackBytes, 0);
  const totFork = rows.reduce((a, r) => a + r.forkBytes, 0);
  const totUpSerena = rows.reduce((a, r) => a + (r.upstreamPlusSerenaBytes ?? r.upWithFallbackBytes), 0);
  const totForkSerena = rows.reduce((a, r) => a + (r.forkPlusSerenaBytes ?? r.forkBytes), 0);
  const upFbFb = rows.filter((r) => r.usedFallback).length;
  const upSerenaFb = rows.filter((r) => r.usedFallback && (r.serenaBytes === null)).length;
  const forkSerenaWins = rows.filter((r) => r.serenaBytes !== null && r.forkPlusSerenaBytes !== null && r.forkPlusSerenaBytes < r.forkBytes).length;

  const pct = (b: number) => totRaw === 0 ? "n/a" : ((1 - b / totRaw) * 100).toFixed(1);
  const tok = (b: number) => Math.round(b / CHARS_PER_TOKEN);

  lines.push(`### Aggregate (sum across all ${rows.length} scenarios)`);
  lines.push("");
  lines.push(`| Side | Bytes | Tokens | Saved % vs raw | Notes |`);
  lines.push(`|------|-------|--------|----------------|-------|`);
  lines.push(`| **Raw native** | ${totRaw} | ${tok(totRaw)} | — | baseline (cat / node -e / curl / grep) |`);
  lines.push(`| **Upstream + native fallback** | ${totUpFb} | ${tok(totUpFb)} | **${pct(totUpFb)}** | ${upFbFb}/${rows.length} fall back to raw |`);
  lines.push(`| **Fork** | ${totFork} | ${tok(totFork)} | **${pct(totFork)}** | full coverage |`);
  if (hasSerena) {
    lines.push(`| **Upstream + Serena** | ${totUpSerena} | ${tok(totUpSerena)} | **${pct(totUpSerena)}** | ${upSerenaFb}/${rows.length} still fall back |`);
    lines.push(`| **Fork + Serena** | ${totForkSerena} | ${tok(totForkSerena)} | **${pct(totForkSerena)}** | Serena beats fork on ${forkSerenaWins} scenario(s) |`);
  }
  lines.push("");

  const forkPct = (1 - totFork / totRaw) * 100;
  const upFbPct = (1 - totUpFb / totRaw) * 100;
  lines.push(`**Fork vs upstream+fallback:** +${(forkPct - upFbPct).toFixed(1)} pp — covers tools upstream lacks (ctx_read, ctx_route, ctx_diff, ctx_trace, ctx_gain, ctx_discover, ctx_fetch_run).`);
  if (hasSerena) {
    const upSerenaPct = (1 - totUpSerena / totRaw) * 100;
    const forkSerenaPct = (1 - totForkSerena / totRaw) * 100;
    lines.push("");
    lines.push(`**Upstream+Serena vs upstream-alone:** +${(upSerenaPct - upFbPct).toFixed(1)} pp — Serena fills upstream's ctx_read gap with symbol overviews.`);
    lines.push("");
    lines.push(`**Fork+Serena vs fork-alone:** +${(forkSerenaPct - forkPct).toFixed(1)} pp — Serena's symbol overview is smaller than fork's ctx_read map on ${forkSerenaWins} scenario(s).`);
    lines.push("");
    lines.push(`**Fork+Serena vs Upstream+Serena:** +${(forkSerenaPct - upSerenaPct).toFixed(1)} pp — fork's broader tool coverage (sandbox, FTS, web, line slice) still dominates.`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderInvocationTotals(buckets: SidePair): string {
  const lines: string[] = [];
  const forkT = totals(buckets.fork);
  const upT = totals(buckets.upstream);
  lines.push(`## Invocation totals (coverage-mixed, not normalized efficiency)`);
  lines.push("");
  lines.push(`These totals include different invocation counts and fork-only tools, so they are useful for coverage/cost visibility but should not be used as the headline efficiency claim.`);
  lines.push("");
  lines.push(`| Side | Invocations | Input tokens | Output tokens | Total | Input bytes | Output bytes |`);
  lines.push(`|------|-------------|--------------|---------------|-------|-------------|--------------|`);
  lines.push(`| fork | ${forkT.invocations} | ${forkT.inputTokens} | ${forkT.outputTokens} | ${forkT.inputTokens + forkT.outputTokens} | ${forkT.inputBytes} | ${forkT.outputBytes} |`);
  lines.push(`| upstream | ${upT.invocations} | ${upT.inputTokens} | ${upT.outputTokens} | ${upT.inputTokens + upT.outputTokens} | ${upT.inputBytes} | ${upT.outputBytes} |`);
  lines.push("");
  const upTotalTok = upT.inputTokens + upT.outputTokens;
  if (upTotalTok > 0) {
    const deltaPct = ((forkT.inputTokens + forkT.outputTokens - upTotalTok) / upTotalTok) * 100;
    lines.push(`**Coverage-mixed fork vs upstream total tokens:** ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`);
    lines.push("");
  }
  return lines.join("\n");
}

function renderMd(
  buckets: SidePair,
  sources: Record<string, string | null>,
  savings: ScenarioSavingsRow[],
  meta: ReturnType<typeof buildMeta>,
  extra: {
    workflowsData: any;
    serenaMap: Map<string, SerenaBaselineRow>;
    perToolFiles: string[];
    rawMap: Map<string, RawBaselineRow>;
    workflowRawMap: Map<string, number>;
  },
): string {
  const lines: string[] = [];
  lines.push(`# Token breakdown — fork vs upstream`);
  lines.push("");
  lines.push(`- **Scope:** 17-scenario token estimate, plus the quality-adjusted workflow suite when workflow artifacts are present.`);
  lines.push(`- **Estimator:** \`bytes / ${CHARS_PER_TOKEN}\` (override via \`CHARS_PER_TOKEN\`)`);
  lines.push(`- **Quality gate:** workflow savings count only fork steps with \`ok === true\` and \`oracleOk === true\`; excluded failures and no-oracle rows are reported in the workflow breakout.`);
  lines.push(`- **Repro:** fork \`${meta.fork_sha}\`, dirty files ${meta.fork_dirty_count}, upstream pin \`${meta.upstream_pin}\`.`);
  lines.push(`- **Sources:**`);
  for (const [k, v] of Object.entries(sources)) lines.push(`  - ${k}: \`${v ?? "(missing)"}\``);
  lines.push("");
  const savingsMd = renderSavingsMd(savings);
  if (savingsMd) {
    lines.push(savingsMd);
  } else {
    lines.push(`## Savings vs raw native tools`);
    lines.push("");
    lines.push(`_No raw-baseline-*.json found. Run \`npm run compare:raw\` to populate._`);
    lines.push("");
  }
  const wfBreakout = renderWorkflowBreakout(extra.workflowsData, extra.serenaMap, extra.workflowRawMap);
  if (wfBreakout) {
    lines.push(wfBreakout);
  }
  const nonRaw = renderNonRawScenarios(extra.perToolFiles, extra.rawMap, extra.serenaMap);
  if (nonRaw) {
    lines.push(nonRaw);
  }
  lines.push(renderInvocationTotals(buckets));
  lines.push("");
  lines.push(`## Per-tool`);
  lines.push("");
  lines.push(renderTable("By tool", sortByOutputDesc(buckets.fork.byTool), buckets.upstream.byTool, buckets.serena.byTool, "Tool"));
  lines.push("");
  lines.push(renderTable("By category", sortByOutputDesc(buckets.fork.byCategory as Map<string, TokenObservation>), buckets.upstream.byCategory as Map<string, TokenObservation>, buckets.serena.byCategory as Map<string, TokenObservation>, "Category"));
  lines.push("");
  lines.push(renderTable("By displaced native tool", sortByOutputDesc(buckets.fork.byDisplaced as Map<string, TokenObservation>), buckets.upstream.byDisplaced as Map<string, TokenObservation>, buckets.serena.byDisplaced as Map<string, TokenObservation>, "Native displaced"));
  lines.push("");
  lines.push(`## Notes`);
  lines.push(`- "Calls" = invocations counted from reports (per-tool counts iterations × scenarios; workflows count one per step).`);
  lines.push(`- "In tok" = estimateTokens(input bytes). Input bytes = JSON.stringify(args).length.`);
  lines.push(`- "Out tok" = estimateTokens(payload bytes). Payload = sum of content[*].text bytes.`);
  lines.push(`- "Native displaced" maps context-mode tools to the native Claude Code tool they substitute (e.g. ctx_execute ↔ Bash). \`(none)\` for tools with no native equivalent.`);
  return lines.join("\n") + "\n";
}

function logSummary(buckets: SidePair): void {
  const fT = totals(buckets.fork);
  const uT = totals(buckets.upstream);
  console.log(`[compare] FORK     in=${fT.inputTokens} tok out=${fT.outputTokens} tok total=${fT.inputTokens + fT.outputTokens} tok (${fT.invocations} calls)`);
  console.log(`[compare] UPSTREAM in=${uT.inputTokens} tok out=${uT.outputTokens} tok total=${uT.inputTokens + uT.outputTokens} tok (${uT.invocations} calls)`);
}

function main(): void {
  if (!existsSync(reportDir)) {
    console.error(`[compare] no reports at ${reportDir}. Run npm run compare:full first.`);
    process.exit(2);
  }
  const buckets: SidePair = { fork: emptyBuckets(), upstream: emptyBuckets(), serena: emptyBuckets() };

  const perToolReports = readdirSync(reportDir)
    .filter((f) => f.endsWith(".json") &&
      !f.startsWith("workflows-") &&
      !f.startsWith("research-report-") &&
      !f.startsWith("stat-validate-") &&
      !f.startsWith("tokens-") &&
      !f.startsWith("raw-baseline-") &&
      !f.startsWith("workflow-raw-baseline-") &&
      !f.startsWith("serena-baseline-") &&
      !f.startsWith("all-"))
    .sort();
  // Latest per suite name (everything before the timestamp prefix).
  const latestBySuite = new Map<string, string>();
  for (const f of perToolReports) {
    const suite = f.replace(/-\d{4}-\d{2}-\d{2}T.*$/, "");
    latestBySuite.set(suite, f);  // sorted ascending → last wins
  }
  const sources: Record<string, string | null> = {};
  for (const [suite, file] of latestBySuite) {
    const path = join(reportDir, file);
    sources[`per-tool:${suite}`] = path;
    const data = safeJson(path);
    if (data) ingestToolReport(buckets, data);
  }

  const workflows = pickLatest("workflows-");
  sources["workflows"] = workflows;
  if (workflows) {
    const data = safeJson(workflows);
    if (data) ingestWorkflowReport(buckets, data);
  }

  const sv = pickLatest("stat-validate-");
  sources["stat-validate"] = sv;
  if (sv) {
    const data = safeJson(sv);
    if (data) ingestStatValidateReport(buckets, data);
  }

  const rawBaseline = loadRawBaseline();
  const rawPath = pickLatest("raw-baseline-");
  sources["raw-baseline"] = rawPath;
  const serenaBaseline = loadSerenaBaseline();
  const serenaPath = pickLatest("serena-baseline-");
  sources["serena-baseline"] = serenaPath;
  ingestSerenaBaseline(buckets, serenaBaseline);
  const savings = buildScenarioSavings(
    [...latestBySuite.values()].map((f) => join(reportDir, f)),
    rawBaseline,
    serenaBaseline,
  );

  if (totals(buckets.fork).invocations === 0 && totals(buckets.upstream).invocations === 0) {
    console.error(`[compare] no usable data found in build/compare/. Did you run compare:all / compare:workflows / compare:stats-validate?`);
    process.exit(2);
  }

  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `tokens-${ts}.json`);
  const mdPath = join(reportDir, `tokens-${ts}.md`);
  const meta = buildMeta("tokens");
  writeFileSync(jsonPath, JSON.stringify({
    meta,
    chars_per_token: CHARS_PER_TOKEN,
    sources,
    fork:     { totals: totals(buckets.fork),     byTool: Object.fromEntries(buckets.fork.byTool),     byCategory: Object.fromEntries(buckets.fork.byCategory),     byDisplaced: Object.fromEntries(buckets.fork.byDisplaced) },
    upstream: { totals: totals(buckets.upstream), byTool: Object.fromEntries(buckets.upstream.byTool), byCategory: Object.fromEntries(buckets.upstream.byCategory), byDisplaced: Object.fromEntries(buckets.upstream.byDisplaced) },
    savings,
  }, null, 2));
  const workflowsData = workflows ? safeJson(workflows) : null;
  const workflowRawMap = loadWorkflowRaw();
  const workflowRawPath = pickLatest("workflow-raw-baseline-");
  sources["workflow-raw-baseline"] = workflowRawPath;
  const perToolFilePaths = [...latestBySuite.values()].map((f) => join(reportDir, f));
  writeFileSync(mdPath, renderMd(buckets, sources, savings, meta, {
    workflowsData,
    serenaMap: serenaBaseline,
    perToolFiles: perToolFilePaths,
    rawMap: rawBaseline,
    workflowRawMap,
  }));
  logSummary(buckets);
  if (savings.length > 0) {
    const totRaw = savings.reduce((a, r) => a + r.rawBytes, 0);
    const totFork = savings.reduce((a, r) => a + r.forkBytes, 0);
    const upShared = savings.filter((r) => r.upBytes !== null);
    const totUpShared = upShared.reduce((a, r) => a + (r.upBytes ?? 0), 0);
    const upSharedRaw = upShared.reduce((a, r) => a + r.rawBytes, 0);
    const totUpFb = savings.reduce((a, r) => a + r.upWithFallbackBytes, 0);
    const fbCount = savings.filter((r) => r.usedFallback).length;
    const forkPct = (1 - totFork / totRaw) * 100;
    const upSharedPct = (1 - totUpShared / upSharedRaw) * 100;
    const upFbPct = (1 - totUpFb / totRaw) * 100;
    console.log(`[compare] SAVINGS vs raw (${savings.length} scenarios, raw=${totRaw} B / ${Math.round(totRaw / 4)} tok):`);
    console.log(`            raw                        = 0.0% (${totRaw} B / ${Math.round(totRaw / 4)} tok)`);
    console.log(`            upstream + fallback        = ${upFbPct.toFixed(1)}% (${totUpFb} B / ${Math.round(totUpFb / 4)} tok, ${fbCount} fallback)`);
    console.log(`            fork                       = ${forkPct.toFixed(1)}% (${totFork} B / ${Math.round(totFork / 4)} tok)`);
    const sApplicable = savings.filter((r) => r.serenaBytes !== null);
    if (sApplicable.length > 0) {
      const totUpSerena = savings.reduce((a, r) => a + (r.upstreamPlusSerenaBytes ?? r.upWithFallbackBytes), 0);
      const totForkSerena = savings.reduce((a, r) => a + (r.forkPlusSerenaBytes ?? r.forkBytes), 0);
      const upSerenaPct = (1 - totUpSerena / totRaw) * 100;
      const forkSerenaPct = (1 - totForkSerena / totRaw) * 100;
      console.log(`            upstream + serena          = ${upSerenaPct.toFixed(1)}% (${totUpSerena} B / ${Math.round(totUpSerena / 4)} tok)`);
      console.log(`            fork + serena              = ${forkSerenaPct.toFixed(1)}% (${totForkSerena} B / ${Math.round(totForkSerena / 4)} tok)`);
      console.log(`            fork advantage over up+serena  = ${(forkSerenaPct - upSerenaPct).toFixed(1)}pp`);
    }
    console.log(`            fork advantage over up+fallback = ${(forkPct - upFbPct).toFixed(1)}pp`);
  }
  console.log(`[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);
  void categorize; // tree-shake guard
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
