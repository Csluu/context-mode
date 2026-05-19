// Orchestrator for workflow comparison. Loads every workflow under
// tests/compare/workflows/, runs each against fork + upstream, writes
// combined report at build/compare/workflows-<ts>.{json,md}.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import { preflight } from "./lib.js";
import {
  logWorkflow, runWorkflow, workflowRowOk, writeWorkflowReport, type Workflow, type WorkflowRow,
} from "./workflows/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, "workflows");

async function loadAll(): Promise<Workflow[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  const out: Workflow[] = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const wf: Workflow | undefined = mod.default;
    if (wf && Array.isArray(wf.steps)) out.push(wf);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function main(): Promise<void> {
  preflight();
  const workflows = await loadAll();
  console.log(`[compare] running ${workflows.length} workflow(s): ${workflows.map((w) => w.name).join(", ")}`);
  const rows: WorkflowRow[] = [];
  for (const wf of workflows) {
    console.log(`\n[compare] === workflow: ${wf.name} ===`);
    const row = await runWorkflow(wf);
    rows.push(row);
    logWorkflow(row);
  }
  const { jsonPath, mdPath } = writeWorkflowReport(rows);
  console.log(`\n[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);
  const failed = rows.filter((row) => !workflowRowOk(row));
  if (failed.length > 0) {
    console.error(`[compare] ${failed.length} workflow(s) failed`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
