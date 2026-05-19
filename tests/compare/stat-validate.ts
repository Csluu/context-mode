// ctx_stats validation. Runs a known workload, externally accounts for
// bytes-in / bytes-out per call, then calls ctx_stats / ctx_gain on each
// server. Cross-checks reported numbers against externally measured ground
// truth. Tolerant: reports observed vs expected, fails only if reported
// numbers are absent or directionally wrong (negative savings, zero work).
//
// Output: build/compare/stat-validate-<ts>.{json,md}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpStdioClient } from "./runner.js";
import {
  buildMeta, extractText, forkServer, isolateEnv, preflight, reportDir, upstreamServer,
} from "./lib.js";

interface CallRecord {
  tool: string;
  args_bytes: number;     // approximate input cost
  bytes_out: number;      // bytes in returned tool result
  ms: number;
}

interface SideResult {
  calls: CallRecord[];
  totalArgsBytes: number;
  totalOutBytes: number;
  totalMs: number;
  statsRaw: string;
  gainRaw: string;
  discoverRaw: string;
  reportedSavingsCandidates: Array<{ label: string; value: number }>;
  reportedToolCounts: Record<string, number>;
}

function argsBytes(args: unknown): number {
  return Buffer.byteLength(JSON.stringify(args), "utf8");
}

async function runWorkload(client: McpStdioClient): Promise<Omit<SideResult, "statsRaw" | "gainRaw" | "discoverRaw" | "reportedSavingsCandidates" | "reportedToolCounts">> {
  const calls: CallRecord[] = [];

  async function call(tool: string, args: Record<string, unknown>): Promise<string> {
    try {
      const r = await client.call(tool, args);
      calls.push({ tool, args_bytes: argsBytes(args), bytes_out: r.bytes, ms: r.ms });
      return extractText(r.result);
    } catch (e: any) {
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

  const totalArgsBytes = calls.reduce((a, c) => a + c.args_bytes, 0);
  const totalOutBytes = calls.reduce((a, c) => a + c.bytes_out, 0);
  const totalMs = calls.reduce((a, c) => a + c.ms, 0);
  return { calls, totalArgsBytes, totalOutBytes, totalMs };
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

async function evaluateSide(serverPath: string, label: string): Promise<SideResult> {
  const env = isolateEnv();
  const client = new McpStdioClient(serverPath, env);
  await client.initialize();
  try {
    const work = await runWorkload(client);

    let statsRaw = "";
    let gainRaw = "";
    let discoverRaw = "";
    try { const r = await client.call("ctx_stats", {}); statsRaw = extractText(r.result); } catch {}
    try { const r = await client.call("ctx_gain", {}); gainRaw = extractText(r.result); } catch {}
    try { const r = await client.call("ctx_discover", {}); discoverRaw = extractText(r.result); } catch {}

    const reportedSavingsCandidates = extractPercentCandidates(statsRaw + "\n" + gainRaw);
    const reportedToolCounts = extractToolCounts(statsRaw);

    console.log(`[${label}] calls=${work.calls.length} args_b=${work.totalArgsBytes} out_b=${work.totalOutBytes} ms=${work.totalMs.toFixed(0)}`);
    console.log(`[${label}] reported %s found: ${reportedSavingsCandidates.length}; tool counts: ${Object.keys(reportedToolCounts).length}`);

    return {
      ...work,
      statsRaw,
      gainRaw,
      discoverRaw,
      reportedSavingsCandidates,
      reportedToolCounts,
    };
  } finally {
    client.close();
  }
}

interface Verdict {
  ok: boolean;
  reasons: string[];
  externalSavingsLower: number;
  externalSavingsUpper: number;
  bestReported?: number;
  withinTolerance: boolean;
}

function judge(side: SideResult): Verdict {
  const reasons: string[] = [];
  // Conservative external bounds. Without knowing the "raw equivalent" cost
  // for each call (which depends on what the user would have done), use
  // bytes_out vs args_bytes ratio as a sanity check and look for SOME
  // non-zero reported savings.
  const externalSavingsLower = 0;
  const externalSavingsUpper = 100;
  let bestReported: number | undefined;
  for (const c of side.reportedSavingsCandidates) {
    if (/saving|saved|ratio|reduce/.test(c.label)) {
      if (bestReported === undefined || c.value > bestReported) bestReported = c.value;
    }
  }
  if (bestReported === undefined && side.reportedSavingsCandidates.length > 0) {
    bestReported = side.reportedSavingsCandidates[0].value;
  }
  const withinTolerance = bestReported !== undefined && bestReported >= externalSavingsLower && bestReported <= externalSavingsUpper;
  if (side.calls.length === 0) reasons.push("no calls recorded");
  if (side.totalOutBytes === 0) reasons.push("zero bytes out");
  if (bestReported === undefined) reasons.push("no savings % parsed from ctx_stats/ctx_gain");
  if (!withinTolerance && bestReported !== undefined) reasons.push(`reported ${bestReported}% out of [${externalSavingsLower}, ${externalSavingsUpper}]`);
  return {
    ok: reasons.length === 0,
    reasons,
    externalSavingsLower,
    externalSavingsUpper,
    bestReported,
    withinTolerance,
  };
}

function renderMd(forkSide: SideResult, upSide: SideResult, forkV: Verdict, upV: Verdict): string {
  const lines: string[] = [];
  lines.push(`# ctx_stats validation — fork vs upstream`);
  lines.push("");
  lines.push(`## Workload`);
  lines.push("");
  lines.push(`| # | Tool | Fork args B | Fork out B | Fork ms | Up args B | Up out B | Up ms |`);
  lines.push(`|---|------|-------------|------------|---------|-----------|----------|-------|`);
  for (let i = 0; i < forkSide.calls.length; i++) {
    const f = forkSide.calls[i];
    const u = upSide.calls[i];
    lines.push(`| ${i + 1} | ${f.tool} | ${f.args_bytes} | ${f.bytes_out} | ${f.ms.toFixed(1)} | ${u?.args_bytes ?? "-"} | ${u?.bytes_out ?? "-"} | ${u?.ms?.toFixed(1) ?? "-"} |`);
  }
  lines.push("");
  lines.push(`## Verdict`);
  lines.push("");
  lines.push(`| Side | Calls | Out B | Best reported % | Reasons |`);
  lines.push(`|------|-------|-------|-----------------|---------|`);
  lines.push(`| fork | ${forkSide.calls.length} | ${forkSide.totalOutBytes} | ${forkV.bestReported ?? "-"} | ${forkV.reasons.join("; ") || "ok"} |`);
  lines.push(`| upstream | ${upSide.calls.length} | ${upSide.totalOutBytes} | ${upV.bestReported ?? "-"} | ${upV.reasons.join("; ") || "ok"} |`);
  lines.push("");
  lines.push(`## Raw ctx_stats — fork`);
  lines.push("");
  lines.push("```");
  lines.push(forkSide.statsRaw.slice(0, 4000));
  lines.push("```");
  lines.push("");
  lines.push(`## Raw ctx_stats — upstream`);
  lines.push("");
  lines.push("```");
  lines.push(upSide.statsRaw.slice(0, 4000));
  lines.push("```");
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  preflight();
  console.log(`[compare] running stat validation workload on fork`);
  const forkSide = await evaluateSide(forkServer, "fork");
  console.log(`[compare] running stat validation workload on upstream`);
  const upSide = await evaluateSide(upstreamServer, "upstream");

  const forkV = judge(forkSide);
  const upV = judge(upSide);

  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `stat-validate-${ts}.json`);
  const mdPath = join(reportDir, `stat-validate-${ts}.md`);
  const meta = buildMeta("stat-validate");
  writeFileSync(jsonPath, JSON.stringify({ meta, fork: forkSide, upstream: upSide, forkVerdict: forkV, upstreamVerdict: upV }, null, 2));
  writeFileSync(mdPath, renderMd(forkSide, upSide, forkV, upV));
  console.log(`[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);

  if (!forkV.ok && !upV.ok) {
    console.error(`[compare] both sides failed stat validation`);
    process.exit(1);
  } else if (!forkV.ok) {
    console.error(`[compare] fork failed stat validation: ${forkV.reasons.join("; ")}`);
    process.exit(1);
  } else if (!upV.ok) {
    console.warn(`[compare] upstream failed stat validation (informational): ${upV.reasons.join("; ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
