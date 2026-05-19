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
import { buildMeta, reportDir } from "./lib.js";
import {
  CHARS_PER_TOKEN, categorize, emptyBuckets, record, totals,
  type AggregateBuckets, type TokenObservation,
} from "./token-accounting.js";

interface SidePair {
  fork: AggregateBuckets;
  upstream: AggregateBuckets;
}

function pickLatest(prefix: string): string | null {
  if (!existsSync(reportDir)) return null;
  const files = readdirSync(reportDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
  return files.length > 0 ? join(reportDir, files[files.length - 1]) : null;
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

function renderTable(title: string, rows: Array<[string, TokenObservation]>, upMap: Map<string, TokenObservation>, header: string): string {
  const lines: string[] = [];
  lines.push(`### ${title}`);
  lines.push("");
  lines.push(`| ${header} | Calls (fork) | In tok (fork) | Out tok (fork) | Total (fork) | Calls (up) | In tok (up) | Out tok (up) | Total (up) | Δ total |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const [key, fk] of rows) {
    const up = upMap.get(key);
    const upTotal = (up?.inputTokens ?? 0) + (up?.outputTokens ?? 0);
    const fkTotal = fk.inputTokens + fk.outputTokens;
    const delta = upTotal === 0 ? "n/a" : `${(((fkTotal - upTotal) / upTotal) * 100).toFixed(1)}%`;
    lines.push(
      `| ${key} | ${fk.invocations} | ${fk.inputTokens} | ${fk.outputTokens} | ${fkTotal} | ${up?.invocations ?? 0} | ${up?.inputTokens ?? 0} | ${up?.outputTokens ?? 0} | ${upTotal} | ${delta} |`,
    );
  }
  return lines.join("\n");
}

function renderMd(buckets: SidePair, sources: Record<string, string | null>): string {
  const lines: string[] = [];
  const forkT = totals(buckets.fork);
  const upT = totals(buckets.upstream);
  lines.push(`# Token breakdown — fork vs upstream`);
  lines.push("");
  lines.push(`- **Estimator:** \`bytes / ${CHARS_PER_TOKEN}\` (override via \`CHARS_PER_TOKEN\`)`);
  lines.push(`- **Sources:**`);
  for (const [k, v] of Object.entries(sources)) lines.push(`  - ${k}: \`${v ?? "(missing)"}\``);
  lines.push("");
  lines.push(`## Totals`);
  lines.push("");
  lines.push(`| Side | Invocations | Input tokens | Output tokens | Total | Input bytes | Output bytes |`);
  lines.push(`|------|-------------|--------------|---------------|-------|-------------|--------------|`);
  lines.push(`| fork | ${forkT.invocations} | ${forkT.inputTokens} | ${forkT.outputTokens} | ${forkT.inputTokens + forkT.outputTokens} | ${forkT.inputBytes} | ${forkT.outputBytes} |`);
  lines.push(`| upstream | ${upT.invocations} | ${upT.inputTokens} | ${upT.outputTokens} | ${upT.inputTokens + upT.outputTokens} | ${upT.inputBytes} | ${upT.outputBytes} |`);
  lines.push("");
  const upTotalTok = upT.inputTokens + upT.outputTokens;
  if (upTotalTok > 0) {
    const deltaPct = ((forkT.inputTokens + forkT.outputTokens - upTotalTok) / upTotalTok) * 100;
    lines.push(`**Fork vs upstream total tokens:** ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`);
    lines.push("");
  }
  lines.push(`## Per-tool`);
  lines.push("");
  lines.push(renderTable("By tool", sortByOutputDesc(buckets.fork.byTool), buckets.fork.byTool.size > 0 ? buckets.upstream.byTool : new Map(), "Tool"));
  lines.push("");
  lines.push(renderTable("By category", sortByOutputDesc(buckets.fork.byCategory as Map<string, TokenObservation>), buckets.upstream.byCategory as Map<string, TokenObservation>, "Category"));
  lines.push("");
  lines.push(renderTable("By displaced native tool", sortByOutputDesc(buckets.fork.byDisplaced as Map<string, TokenObservation>), buckets.upstream.byDisplaced as Map<string, TokenObservation>, "Native displaced"));
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
  const buckets: SidePair = { fork: emptyBuckets(), upstream: emptyBuckets() };

  const perToolReports = readdirSync(reportDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("workflows-") && !f.startsWith("stat-validate-") && !f.startsWith("tokens-"))
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
  }, null, 2));
  writeFileSync(mdPath, renderMd(buckets, sources));
  logSummary(buckets);
  console.log(`[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);
  void categorize; // tree-shake guard
}

main();
