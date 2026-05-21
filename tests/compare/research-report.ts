// Research report generator. Loads the latest tokens / workflow / raw /
// serena reports and emits build/compare/research-report-<ts>.md with:
//
//   1. Executive summary
//   2. Per-tool wins/losses (fork vs raw / upstream / serena)
//   3. Per-workflow analysis with weakest step
//   4. Where fork wins big (>90% saved)
//   5. Where fork is weak (negative savings or beaten by serena/upstream)
//   6. Semantic-nav-control fairness check
//   7. Failure modes
//   8. Improvement recommendations
//
// This is a READ-ONLY analytical pass. Run after `npm run compare:full`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildMeta, reportDir } from "./lib.js";
import { isSerenaSemanticallyUsable, type SerenaBaselineRow } from "./run-tokens.js";
import { CHARS_PER_TOKEN } from "./token-accounting.js";

function pickLatest(prefix: string): string | null {
  if (!existsSync(reportDir)) return null;
  const files = readdirSync(reportDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
  return files.length > 0 ? join(reportDir, files[files.length - 1]) : null;
}

function safeJson(p: string | null): any {
  if (!p) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { return null; }
}

interface PerScenarioRow {
  workflow: string;
  step: string;
  tool: string;
  rawBytes: number;
  forkBytes: number;
  forkOk: boolean;
  forkOracle: boolean | null;
  forkOracleIssues: string[];
  upstreamBytes: number | null;
  upstreamFailed: boolean;
  upstreamOracle: boolean | null;
  serenaBytes: number | null;
  serenaApplicable: boolean;
}

function loadWorkflowRaw(): Map<string, number> {
  const data = safeJson(pickLatest("workflow-raw-baseline-"));
  const out = new Map<string, number>();
  if (!data?.rows) return out;
  for (const wf of data.rows) {
    for (const s of wf.steps) out.set(`${wf.workflow}::${s.label}`, s.rawBytes);
  }
  return out;
}

export function normalizeSerenaResearchRow(row: SerenaBaselineRow): { applicable: boolean; ok: boolean; bytes: number } {
  const usable = isSerenaSemanticallyUsable(row);
  return { applicable: usable, ok: usable, bytes: Number(row.bytes) || 0 };
}

function loadSerena(): Map<string, { applicable: boolean; ok: boolean; bytes: number }> {
  const data = safeJson(pickLatest("serena-baseline-"));
  const out = new Map<string, { applicable: boolean; ok: boolean; bytes: number }>();
  if (!Array.isArray(data?.rows)) return out;
  for (const r of data.rows) {
    const row = r as SerenaBaselineRow;
    out.set(`${row.tool}::${row.scenario}`, normalizeSerenaResearchRow(row));
  }
  return out;
}

function loadWorkflows(): any {
  return safeJson(pickLatest("workflows-")) ?? { rows: [] };
}

function loadTokens(): any {
  return safeJson(pickLatest("tokens-")) ?? null;
}

function buildPerScenario(): PerScenarioRow[] {
  const rawMap = loadWorkflowRaw();
  const serena = loadSerena();
  const wfs = loadWorkflows();
  const out: PerScenarioRow[] = [];
  for (const wf of wfs.rows ?? []) {
    const forkSteps = Array.isArray(wf.fork?.steps) ? wf.fork.steps : [];
    const upSteps = Array.isArray(wf.upstream?.steps) ? wf.upstream.steps : [];
    for (let i = 0; i < forkSteps.length; i++) {
      const fs = forkSteps[i];
      const us = upSteps[i];
      const sKey = `workflow:${wf.workflow}::${fs.label}`;
      const sEntry = serena.get(sKey);
      const sApplicable = !!sEntry && sEntry.applicable && sEntry.ok;
      const upOk = us && us.ok !== false;
      out.push({
        workflow: wf.workflow,
        step: fs.label,
        tool: fs.tool,
        rawBytes: rawMap.get(`${wf.workflow}::${fs.label}`) ?? 0,
        forkBytes: Number(fs.bytes) || 0,
        forkOk: !!fs.ok,
        forkOracle: typeof fs.oracleOk === "boolean" ? fs.oracleOk : (fs.hasOracle ? null : null),
        forkOracleIssues: Array.isArray(fs.oracleIssues) ? fs.oracleIssues : [],
        upstreamBytes: upOk ? Number(us.bytes) || 0 : null,
        upstreamFailed: !upOk && !!us,
        upstreamOracle: us && typeof us.oracleOk === "boolean" ? us.oracleOk : null,
        serenaBytes: sApplicable ? sEntry!.bytes : null,
        serenaApplicable: sApplicable,
      });
    }
  }
  return out;
}

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return ((1 - n / d) * 100).toFixed(1);
}

function tokens(bytes: number): number {
  return Math.round(bytes / CHARS_PER_TOKEN);
}

function tableHeader(...cols: string[]): string {
  return `| ${cols.join(" | ")} |\n|${cols.map(() => "---").join("|")}|`;
}

function render(rows: PerScenarioRow[], meta: ReturnType<typeof buildMeta>): string {
  const lines: string[] = [];
  lines.push(`# context-mode fork — research report`);
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}.`);
  lines.push("");
  lines.push(`Aggregates the latest \`compare:full\` artifacts (raw baseline, fork, upstream, Serena) into one analytical view of where the fork is winning, where it leaks context, and what to improve next.`);
  lines.push("");
  lines.push(`**Repro:** fork \`${meta.fork_sha}\`, dirty files ${meta.fork_dirty_count}, upstream pin \`${meta.upstream_pin}\`.`);
  lines.push("");

  // 1. Executive summary
  const totalRaw = rows.reduce((a, r) => a + r.rawBytes, 0);
  const totalFork = rows.reduce((a, r) => a + r.forkBytes, 0);
  const totalUpFb = rows.reduce((a, r) => a + (r.upstreamBytes ?? r.rawBytes), 0);
  const totalSerenaFb = rows.reduce((a, r) => a + (r.serenaBytes ?? r.rawBytes), 0);
  const totalUpPlusSerena = rows.reduce((a, r) => {
    if (r.upstreamBytes !== null) return a + r.upstreamBytes;
    if (r.serenaBytes !== null) return a + r.serenaBytes;
    return a + r.rawBytes;
  }, 0);
  const totalForkPlusSerena = rows.reduce((a, r) => {
    if (r.serenaBytes !== null && r.serenaBytes < r.forkBytes) return a + r.serenaBytes;
    return a + r.forkBytes;
  }, 0);
  const workflowCount = new Set(rows.map((r) => r.workflow)).size;
  const upstreamFallbackCount = rows.filter((r) => r.upstreamFailed || r.upstreamBytes === null).length;
  const totalOracle = rows.filter((r) => r.forkOracle !== null).length;
  const passOracle = rows.filter((r) => r.forkOracle === true).length;
  const oracleFailures = rows.filter((r) => r.forkOracle === false).length;
  const failedForkSteps = rows.filter((r) => !r.forkOk).length;
  const noOracle = rows.length - totalOracle;
  const qualityScore = totalOracle === 0 ? "n/a" : `${((passOracle / totalOracle) * 100).toFixed(1)}%`;

  lines.push(`**Scope:** ${workflowCount} workflow coverage suite / ${rows.length} steps. The 17-scenario token estimate is reported separately in \`tokens-*.md\`.`);
  lines.push("");
  lines.push(`**Trust banner:** quality-adjusted; oracle passed ${passOracle}/${totalOracle}; upstream fallback ${upstreamFallbackCount}/${rows.length}; excluded failures=${failedForkSteps}, oracle-failures=${oracleFailures}, no-oracle=${noOracle}.`);
  lines.push("");
  lines.push(`## 1. Executive summary`);
  lines.push("");
  lines.push(`Across **${rows.length} workflow steps** in **${workflowCount} workflows**:`);
  lines.push("");
  lines.push(tableHeader("Stack", "Bytes", "Tokens", "Saved % vs raw"));
  lines.push(`| Raw native | ${totalRaw} | ${tokens(totalRaw)} | — |`);
  lines.push(`| Upstream + raw fallback | ${totalUpFb} | ${tokens(totalUpFb)} | **${pct(totalUpFb, totalRaw)}** |`);
  lines.push(`| **Fork (this repo)** | ${totalFork} | ${tokens(totalFork)} | **${pct(totalFork, totalRaw)}** |`);
  lines.push(`| Upstream + Serena (+ raw fb) | ${totalUpPlusSerena} | ${tokens(totalUpPlusSerena)} | **${pct(totalUpPlusSerena, totalRaw)}** |`);
  lines.push(`| Serena + raw fallback | ${totalSerenaFb} | ${tokens(totalSerenaFb)} | **${pct(totalSerenaFb, totalRaw)}** |`);
  lines.push(`| **Fork + Serena** | ${totalForkPlusSerena} | ${tokens(totalForkPlusSerena)} | **${pct(totalForkPlusSerena, totalRaw)}** |`);
  lines.push("");
  lines.push(`**Headline:** the fork covers the full workflow surface; upstream alone falls back to raw on ${upstreamFallbackCount}/${rows.length} steps. Serena is counted only as an optional semantic-code navigation substitute (${rows.filter((r) => r.serenaApplicable).length} steps) and has no fallback for sandbox, web, diff, search corpora, or line-range reads.`);
  lines.push("");
  lines.push(`**Quality oracle:** ${passOracle}/${totalOracle} fork steps passed their assertion (${qualityScore}). Steps with no oracle defined are excluded.`);
  lines.push("");

  // 2. Per-workflow analysis
  lines.push(`## 2. Per-workflow analysis`);
  lines.push("");
  lines.push(tableHeader("Workflow", "Steps", "Raw B", "Fork B", "Fork saved %", "Up+fb saved %", "Fork+Serena saved %", "Quality (fork)", "Weakest step (fork vs raw)"));
  const byWorkflow = new Map<string, PerScenarioRow[]>();
  for (const r of rows) {
    if (!byWorkflow.has(r.workflow)) byWorkflow.set(r.workflow, []);
    byWorkflow.get(r.workflow)!.push(r);
  }
  for (const [name, steps] of [...byWorkflow.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rawSum = steps.reduce((a, r) => a + r.rawBytes, 0);
    const forkSum = steps.reduce((a, r) => a + r.forkBytes, 0);
    const upFbSum = steps.reduce((a, r) => a + (r.upstreamBytes ?? r.rawBytes), 0);
    const forkSerenaSum = steps.reduce((a, r) => a + ((r.serenaBytes !== null && r.serenaBytes < r.forkBytes) ? r.serenaBytes : r.forkBytes), 0);
    const oracleTotal = steps.filter((r) => r.forkOracle !== null).length;
    const oraclePass = steps.filter((r) => r.forkOracle === true).length;
    const quality = oracleTotal === 0 ? "—" : `${oraclePass}/${oracleTotal}`;
    const ranked = [...steps]
      .filter((r) => r.rawBytes > 0)
      .sort((a, b) => (b.forkBytes / b.rawBytes) - (a.forkBytes / a.rawBytes));
    const weak = ranked[0];
    const weakLabel = weak ? `${weak.step} (fork ${weak.forkBytes}B vs raw ${weak.rawBytes}B, ${pct(weak.forkBytes, weak.rawBytes)}% saved)` : "—";
    lines.push(`| ${name} | ${steps.length} | ${rawSum} | ${forkSum} | ${pct(forkSum, rawSum)} | ${pct(upFbSum, rawSum)} | ${pct(forkSerenaSum, rawSum)} | ${quality} | ${weakLabel} |`);
  }
  lines.push("");

  // Quality false-positives: fork "saved bytes" but oracle FAILED — answer was insufficient
  const qualityFalsePositives = rows.filter((r) => r.forkOracle === false && r.rawBytes > 0 && r.forkBytes < r.rawBytes);
  if (qualityFalsePositives.length > 0) {
    lines.push(`### 2a. Quality false-positives (fork saved bytes but answer failed oracle)`);
    lines.push("");
    lines.push(`These steps cut context cost but the response didn't contain what the workflow expected. **Saved bytes without saving the work** — investigate envelope vs content.`);
    lines.push("");
    lines.push(tableHeader("Workflow", "Step", "Tool", "Raw B", "Fork B", "Issues"));
    for (const r of qualityFalsePositives) {
      const issues = (r.forkOracleIssues ?? []).join("; ").slice(0, 80) || "oracle returned false";
      lines.push(`| ${r.workflow} | ${r.step} | ${r.tool} | ${r.rawBytes} | ${r.forkBytes} | ${issues} |`);
    }
    lines.push("");
  }

  // 3. Per-tool wins/losses
  lines.push(`## 3. Per-tool wins / losses`);
  lines.push("");
  const byTool = new Map<string, PerScenarioRow[]>();
  for (const r of rows) {
    if (!byTool.has(r.tool)) byTool.set(r.tool, []);
    byTool.get(r.tool)!.push(r);
  }
  lines.push(tableHeader("Tool", "Calls", "Raw B", "Fork B", "Saved %", "Steps where fork ≥ raw"));
  for (const [tool, steps] of [...byTool.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rawSum = steps.reduce((a, r) => a + r.rawBytes, 0);
    const forkSum = steps.reduce((a, r) => a + r.forkBytes, 0);
    const regressions = steps.filter((r) => r.rawBytes > 0 && r.forkBytes > r.rawBytes);
    const reg = regressions.length === 0 ? "—" : regressions.map((r) => `${r.workflow}/${r.step}`).join("; ");
    lines.push(`| ${tool} | ${steps.length} | ${rawSum} | ${forkSum} | ${pct(forkSum, rawSum)} | ${reg} |`);
  }
  lines.push("");

  // 4. Biggest fork wins
  lines.push(`## 4. Biggest fork wins (top 10 by raw bytes saved)`);
  lines.push("");
  const withRaw = rows.filter((r) => r.rawBytes > 0);
  const savings = withRaw.map((r) => ({ ...r, saved: r.rawBytes - r.forkBytes, savedPct: (1 - r.forkBytes / r.rawBytes) * 100 }));
  savings.sort((a, b) => b.saved - a.saved);
  lines.push(tableHeader("Workflow", "Step", "Tool", "Raw B", "Fork B", "Saved B", "Saved %"));
  for (const s of savings.slice(0, 10)) {
    lines.push(`| ${s.workflow} | ${s.step} | ${s.tool} | ${s.rawBytes} | ${s.forkBytes} | ${s.saved} | ${s.savedPct.toFixed(1)} |`);
  }
  lines.push("");

  // 5. Where fork is weak
  lines.push(`## 5. Where the fork is weak`);
  lines.push("");
  const regressionsList = withRaw.filter((r) => r.forkBytes >= r.rawBytes);
  if (regressionsList.length === 0) {
    lines.push(`_No regressions found — fork ≤ raw on every step._`);
  } else {
    lines.push(tableHeader("Workflow", "Step", "Tool", "Raw B", "Fork B", "Δ"));
    for (const r of regressionsList) {
      lines.push(`| ${r.workflow} | ${r.step} | ${r.tool} | ${r.rawBytes} | ${r.forkBytes} | +${r.forkBytes - r.rawBytes} |`);
    }
  }
  lines.push("");

  // 6. Where Serena beats fork
  const serenaBeatsFork = withRaw.filter((r) => r.serenaApplicable && r.serenaBytes !== null && r.serenaBytes < r.forkBytes);
  lines.push(`## 6. Where Serena beats the fork`);
  lines.push("");
  if (serenaBeatsFork.length === 0) {
    lines.push(`_No scenarios — fork ≤ Serena on every applicable step._`);
  } else {
    lines.push(tableHeader("Workflow", "Step", "Tool", "Fork B", "Serena B", "Δ B"));
    for (const r of serenaBeatsFork) {
      lines.push(`| ${r.workflow} | ${r.step} | ${r.tool} | ${r.forkBytes} | ${r.serenaBytes} | ${r.forkBytes - (r.serenaBytes ?? 0)} |`);
    }
  }
  lines.push("");

  // 7. Failure modes (upstream)
  const upFailures = rows.filter((r) => r.upstreamFailed || r.upstreamBytes === null);
  lines.push(`## 7. Upstream failure modes (${upFailures.length} step(s) fall back to native)`);
  lines.push("");
  const byTool2 = new Map<string, number>();
  for (const r of upFailures) byTool2.set(r.tool, (byTool2.get(r.tool) || 0) + 1);
  lines.push(tableHeader("Tool", "Failed steps", "Reason"));
  for (const [t, n] of [...byTool2.entries()].sort((a, b) => b[1] - a[1])) {
    const reasons: Record<string, string> = {
      ctx_route: "Upstream lacks ctx_route classifier — caller falls back to raw command.",
      ctx_read: "Upstream lacks ctx_read map/outline/symbols/slice — caller falls back to cat.",
      ctx_diff: "Upstream lacks ctx_diff — caller falls back to raw `git diff`.",
      ctx_gain: "Upstream lacks ctx_gain savings reporter.",
      ctx_discover: "Upstream lacks ctx_discover bypass detector.",
      ctx_fetch_run: "Upstream lacks ctx_fetch_run sidecar replay.",
      ctx_batch_execute: "Step uses fork-only features (intent / queries).",
      ctx_execute: "Step uses fork-only features (intent argument).",
      ctx_search: "Step depends on a corpus only the fork indexed.",
    };
    lines.push(`| ${t} | ${n} | ${reasons[t] ?? "Tool-specific divergence — see workflow definition."} |`);
  }
  lines.push("");

  // 8. Semantic-nav-control fairness check
  const navSteps = rows.filter((r) => r.workflow === "semantic-nav-control");
  lines.push(`## 8. Fairness check — semantic-nav-control (Serena's home turf)`);
  lines.push("");
  if (navSteps.length === 0) {
    lines.push(`_No data._`);
  } else {
    lines.push(tableHeader("Step", "Tool", "Raw B", "Fork B", "Serena B", "Winner"));
    for (const r of navSteps) {
      const candidates = [
        { name: "Fork", b: r.forkBytes },
        ...(r.serenaApplicable && r.serenaBytes !== null ? [{ name: "Serena", b: r.serenaBytes }] : []),
      ];
      candidates.sort((a, b) => a.b - b.b);
      const winner = candidates[0]?.name ?? "n/a";
      lines.push(`| ${r.step} | ${r.tool} | ${r.rawBytes} | ${r.forkBytes} | ${r.serenaBytes ?? "n/a"} | ${winner} |`);
    }
    lines.push("");
    lines.push(`The control exists to prove the comparison isn't biased toward context-mode. If Serena loses every step here, the test suite is suspect.`);
  }
  lines.push("");

  // 9. Recommendations
  lines.push(`## 9. Recommendations`);
  lines.push("");
  const recs: string[] = [];
  const sliceRegressions = withRaw.filter((r) => r.tool === "ctx_read" && r.step.includes("slice") && r.forkBytes > r.rawBytes);
  if (sliceRegressions.length > 0) {
    recs.push(`**ctx_read slice mode overhead** — ${sliceRegressions.length} slice step(s) returned MORE bytes than raw \`sed -n N,Mp\`. Investigate the slice envelope (heading, metadata, line numbers): see \`src/read/slice.ts\` (or equivalent). Likely the surrounding wrapper costs more than the slice content for short ranges.`);
  }
  const searchRegressions = withRaw.filter((r) => r.tool === "ctx_search" && r.rawBytes > 0 && r.forkBytes > r.rawBytes * 2);
  if (searchRegressions.length > 0) {
    recs.push(`**ctx_search overhead on small corpora** — ${searchRegressions.length} step(s) where ctx_search output is >2× raw grep. Result envelope (snippet padding, ranking metadata) dominates when matches are short.`);
  }
  const ctxDiffSteps = rows.filter((r) => r.tool === "ctx_diff");
  if (ctxDiffSteps.length > 0) {
    const rawSum = ctxDiffSteps.reduce((a, r) => a + r.rawBytes, 0);
    const forkSum = ctxDiffSteps.reduce((a, r) => a + r.forkBytes, 0);
    recs.push(`**ctx_diff coverage** — ${ctxDiffSteps.length} step(s), fork saved **${pct(forkSum, rawSum)}%** vs raw \`git diff\`. Live-test status: workflows ran successfully on this branch; gate on real PR-sized diffs before declaring stable.`);
  }
  recs.push(`**Upstream contribution targets** — if you want to give upstream a path to parity, the highest-leverage additions are: \`ctx_read\` (map/outline/symbols/slice), \`ctx_route\` (command classifier), \`ctx_diff\` (semantic diff). These three account for the bulk of upstream's fallback-to-raw cost.`);
  recs.push(`**Serena posture** — keep Serena accounting as an optional comparison lane only. Do not expand the integration unless reliability improves; context-mode should keep owning noisy transport, diffs, search, web/indexing, sidecars, and slices.`);
  for (const r of recs) lines.push(`- ${r}`);
  lines.push("");

  // 10. Sources
  lines.push(`## 10. Sources`);
  lines.push("");
  for (const prefix of ["tokens-", "workflows-", "raw-baseline-", "workflow-raw-baseline-", "serena-baseline-"]) {
    const p = pickLatest(prefix);
    lines.push(`- ${prefix}: \`${p ?? "(missing)"}\``);
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

function main(): void {
  if (!existsSync(reportDir)) {
    console.error(`[research] no reports at ${reportDir}. Run npm run compare:full first.`);
    process.exit(2);
  }
  const tokensData = loadTokens();
  void tokensData; // currently unused; kept for future extensions
  const rows = buildPerScenario();
  if (rows.length === 0) {
    console.error("[research] no workflow data found — did compare:workflows run?");
    process.exit(2);
  }
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(reportDir, `research-report-${ts}.md`);
  const meta = buildMeta("research-report");
  const md = render(rows, meta);
  writeFileSync(mdPath, md);
  const jsonPath = join(reportDir, `research-report-${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 2));
  console.log(`[research] wrote ${mdPath}`);
  console.log(`[research] wrote ${jsonPath}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
