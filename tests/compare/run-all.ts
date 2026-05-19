// Orchestrator: runs every suite under tests/compare/tools/, writes
// per-suite reports plus a combined report at build/compare/all-<ts>.{json,md}.
// Exits non-zero if any suite has divergent or errored rows.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import {
  buildMeta, exitOnFailure, logRow, preflight, type Row, writeReport,
} from "./lib.js";
import type { Suite } from "./suite.js";
import { runSuite } from "./run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolsDir = resolve(__dirname, "tools");

async function loadAllSuites(): Promise<Suite[]> {
  const files = readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));
  const suites: Suite[] = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(toolsDir, f)).href);
    const suite: Suite | undefined = mod.default;
    if (suite && Array.isArray(suite.scenarios)) suites.push(suite);
  }
  suites.sort((a, b) => a.name.localeCompare(b.name));
  return suites;
}

async function main(): Promise<void> {
  preflight();
  const suites = await loadAllSuites();
  console.log(`[compare] running ${suites.length} suite(s): ${suites.map((s) => s.name).join(", ")}`);
  const allRows: Row[] = [];
  const perSuite: Record<string, Row[]> = {};
  for (const suite of suites) {
    console.log(`\n[compare] === suite: ${suite.name} ===`);
    const rows = await runSuite(suite);
    perSuite[suite.name] = rows;
    allRows.push(...rows);
    const meta = buildMeta(suite.name);
    const { jsonPath, mdPath } = writeReport(suite.name, rows, meta);
    console.log(`[compare] wrote ${jsonPath}`);
    console.log(`[compare] wrote ${mdPath}`);
  }
  const combinedMeta = buildMeta("all");
  const { jsonPath, mdPath } = writeReport("all", allRows, combinedMeta);
  console.log(`\n[compare] combined report: ${mdPath}`);
  console.log(`[compare] combined JSON:   ${jsonPath}`);

  const summary = allRows.reduce<Record<string, number>>((acc, r) => { acc[r.parity] = (acc[r.parity] || 0) + 1; return acc; }, {});
  console.log(`[compare] summary: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  exitOnFailure(allRows);
}

main().catch((e) => { console.error(e); process.exit(1); });
