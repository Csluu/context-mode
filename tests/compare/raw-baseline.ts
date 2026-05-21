// Raw native tools baseline. For each shared-tool scenario, runs the
// equivalent "no-context-mode" operation (cat / node -e / bash / curl / grep)
// and records the bytes that would have entered Claude's context.
//
// Pairs with run-tokens.ts to compute true savings %:
//   savings_fork     = (1 - fork_output_bytes     / raw_bytes) × 100
//   savings_upstream = (1 - upstream_output_bytes / raw_bytes) × 100
//
// Output: build/compare/raw-baseline-<ts>.{json,md}

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server.js";
import { buildMeta, reportDir } from "./lib.js";
import { CHARS_PER_TOKEN, estimateTokens } from "./token-accounting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

interface BaselineRow {
  /** ctx_* tool this raw op corresponds to. */
  tool: string;
  /** Scenario name from per-tool suites. Matches Row.scenario in compare reports. */
  scenario: string;
  /** Human description of the raw equivalent. */
  rawEquivalent: string;
  /** Bytes the raw op would dump into context. */
  rawBytes: number;
  /** Tokens (rawBytes / CHARS_PER_TOKEN). */
  rawTokens: number;
}

function rawCat(path: string): number {
  return readFileSync(path).length;
}

function rawNodeExec(code: string): number {
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "buffer" });
  return (r.stdout?.length ?? 0) + (r.stderr?.length ?? 0);
}

function rawShellEcho(cmd: string): number {
  const r = spawnSync(cmd, { shell: true, encoding: "buffer" });
  return (r.stdout?.length ?? 0) + (r.stderr?.length ?? 0);
}

function rawBatch(commands: string[]): number {
  let total = 0;
  for (const c of commands) total += rawShellEcho(c);
  return total;
}

async function rawHttpGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpRequest(url, (res) => {
      let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; });
      res.on("end", () => resolve(bytes));
      res.on("error", reject);
    }).on("error", reject).end();
  });
}

function rawGrep(corpus: string, pattern: RegExp): number {
  const matches = corpus.split("\n").filter((l) => pattern.test(l));
  return Buffer.byteLength(matches.join("\n"), "utf8");
}

async function buildBaseline(): Promise<BaselineRow[]> {
  const rows: BaselineRow[] = [];
  const fixture = join(repoRoot, "tests", "compare", "fixtures", "pinned-executor.ts");
  const fixtureBytes = rawCat(fixture);

  // ctx_read (fork-only — useful for "what would Read have cost")
  for (const mode of ["map-executor", "outline-executor", "symbols-executor"]) {
    rows.push({
      tool: "ctx_read", scenario: mode,
      rawEquivalent: `cat ${fixture}`,
      rawBytes: fixtureBytes,
      rawTokens: estimateTokens(fixtureBytes),
    });
  }
  rows.push({
    tool: "ctx_read", scenario: "slice-1-80",
    rawEquivalent: `head -n 80 ${fixture}`,
    rawBytes: readFileSync(fixture, "utf8").split("\n").slice(0, 80).join("\n").length,
    rawTokens: 0, // fill below
  });
  rows[rows.length - 1].rawTokens = estimateTokens(rows[rows.length - 1].rawBytes);

  // ctx_execute — code body baked into args; raw = node -e {code} stdout
  const jsHello = `console.log("hello from ctx_execute");`;
  const jsSum = `const arr = Array.from({ length: 1000 }, (_, i) => i); console.log("sum=" + arr.reduce((a, b) => a + b, 0));`;
  const jsBigOutput = `for (let i = 0; i < 200; i++) { console.log("line " + i + " ".repeat(50) + "filler-token-" + i); } console.log("ERROR: synthetic failure marker");`;
  const execScenarios = [
    { scenario: "js-hello", raw: rawNodeExec(jsHello) },
    { scenario: "js-sum", raw: rawNodeExec(jsSum) },
    { scenario: "shell-echo", raw: rawShellEcho("echo compare-hello") },
    { scenario: "js-intent-large", raw: rawNodeExec(jsBigOutput) },
  ];
  for (const e of execScenarios) {
    rows.push({
      tool: "ctx_execute", scenario: e.scenario,
      rawEquivalent: "node -e <code>",
      rawBytes: e.raw,
      rawTokens: estimateTokens(e.raw),
    });
  }

  // ctx_batch_execute — sum of raw shell stdouts
  const batchCommands = [
    "git status --porcelain",
    "node --version",
    "echo 'comparison-fixture-line alpha bravo charlie'",
  ];
  rows.push({
    tool: "ctx_batch_execute", scenario: "three-cmd-five-q",
    rawEquivalent: "git status + node --version + echo (concatenated)",
    rawBytes: rawBatch(batchCommands),
    rawTokens: 0,
  });
  rows[rows.length - 1].rawTokens = estimateTokens(rows[rows.length - 1].rawBytes);
  rows.push({
    tool: "ctx_batch_execute", scenario: "single-cmd",
    rawEquivalent: "node -e console.log(platform,arch)",
    rawBytes: rawNodeExec(`console.log(process.platform, process.arch)`),
    rawTokens: 0,
  });
  rows[rows.length - 1].rawTokens = estimateTokens(rows[rows.length - 1].rawBytes);

  // ctx_search — raw grep on the seeded corpus
  const corpus = [
    "alpha alpha bravo charlie delta echo",
    "bravo bravo charlie delta echo foxtrot",
    "charlie charlie delta echo foxtrot golf",
  ].join("\n");
  const searchScenarios = [
    { scenario: "single-q-alpha", pat: /alpha/i },
    { scenario: "multi-q", pat: /alpha|bravo|charlie/i },
    { scenario: "scoped-source", pat: /delta/i },
    { scenario: "high-limit", pat: /echo/i },
  ];
  for (const s of searchScenarios) {
    const b = rawGrep(corpus, s.pat);
    rows.push({
      tool: "ctx_search", scenario: s.scenario,
      rawEquivalent: `grep ${s.pat.source} corpus`,
      rawBytes: b,
      rawTokens: estimateTokens(b),
    });
  }

  // ctx_fetch_and_index — raw HTTP body via local fixture server
  const server = await startFixtureServer();
  try {
    const fetchScenarios: Array<{ scenario: string; routes: string[] }> = [
      { scenario: "single-react", routes: ["/docs/react-useEffect"] },
      { scenario: "single-nextjs", routes: ["/docs/nextjs"] },
      {
        scenario: "batch-four",
        routes: ["/docs/react-useEffect", "/docs/nextjs", "/docs/tailwind", "/docs/supabase"],
      },
    ];
    for (const f of fetchScenarios) {
      let total = 0;
      for (const r of f.routes) total += await rawHttpGet(server.url(r));
      rows.push({
        tool: "ctx_fetch_and_index", scenario: f.scenario,
        rawEquivalent: `curl ${f.routes.join(" + ")}`,
        rawBytes: total,
        rawTokens: estimateTokens(total),
      });
    }
  } finally {
    await server.close();
  }

  // ctx_batch_execute (debug-test workflow simulate-vitest) — already covered above

  return rows;
}

function renderMd(rows: BaselineRow[]): string {
  const lines: string[] = [];
  lines.push(`# Raw native tools baseline`);
  lines.push("");
  lines.push(`Bytes each ctx_* call REPLACES. Pair with per-tool/workflow reports`);
  lines.push(`to compute savings:`);
  lines.push("");
  lines.push(`    savings_fork     = (1 − fork_output_bytes     / raw_bytes) × 100`);
  lines.push(`    savings_upstream = (1 − upstream_output_bytes / raw_bytes) × 100`);
  lines.push("");
  lines.push(`Token estimator: \`bytes / ${CHARS_PER_TOKEN}\` (override via CHARS_PER_TOKEN).`);
  lines.push("");
  lines.push(`| Tool | Scenario | Raw equivalent | Raw bytes | Raw tokens |`);
  lines.push(`|------|----------|----------------|-----------|------------|`);
  for (const r of rows) {
    lines.push(`| ${r.tool} | ${r.scenario} | ${r.rawEquivalent} | ${r.rawBytes} | ${r.rawTokens} |`);
  }
  const tot = rows.reduce((acc, r) => ({ b: acc.b + r.rawBytes, t: acc.t + r.rawTokens }), { b: 0, t: 0 });
  lines.push("");
  lines.push(`**Totals across all baseline scenarios:** ${tot.b} bytes, ${tot.t} tokens.`);
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  console.log(`[compare] building raw native baseline`);
  const rows = await buildBaseline();
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `raw-baseline-${ts}.json`);
  const mdPath = join(reportDir, `raw-baseline-${ts}.md`);
  const meta = buildMeta("raw-baseline");
  writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 2));
  writeFileSync(mdPath, renderMd(rows));
  for (const r of rows) {
    console.log(` ${r.tool.padEnd(22)} ${r.scenario.padEnd(28)} raw=${r.rawBytes}B (${r.rawTokens} tok)`);
  }
  console.log(`[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
