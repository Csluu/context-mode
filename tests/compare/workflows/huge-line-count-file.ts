// Tier 3: ctx_read map on a file with 100K lines. Validates that map mode
// produces a bounded summary rather than dumping the whole thing.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let tmpDir: string | null = null;
let bigPath: string | null = null;

const wf: Workflow = {
  name: "huge-line-count-file",
  description: "Generate a 100K-line text file and ctx_read map / slice / outline it. Validates bounded summary on huge inputs.",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-huge");
    mkdirSync(tmpDir, { recursive: true });
    bigPath = join(tmpDir, "huge.log");
    const lines: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      lines.push(`[${i % 4 === 0 ? "INFO" : i % 4 === 1 ? "WARN" : i % 4 === 2 ? "ERROR" : "DEBUG"}] event ${i} token-${i % 31}`);
    }
    writeFileSync(bigPath, lines.join("\n"), "utf8");
    this.steps = [
      { label: "map",     tool: "ctx_read", args: { path: bigPath, mode: "map" },     assert: (t) => t.length > 50 && t.length < 50_000 },
      { label: "outline", tool: "ctx_read", args: { path: bigPath, mode: "outline" }, assert: (t) => t.length > 0 && t.length < 50_000 },
      { label: "slice",   tool: "ctx_read", args: { path: bigPath, mode: "slice", compact: true, start: 1, end: 50 }, assert: (t) => /event 0|INFO/.test(t) },
    ];
  },
  async afterAll() {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } tmpDir = null; bigPath = null; }
  },
  steps: [],
};

export default wf;
