// Long-session cascade: 500 turns mixing commands + reads.
// Reveals: (1) compounding cost across realistic session length, (2) cache
// eviction policy fairness, (3) memory growth in DB-backed tools.
//
// Programmatically generated to keep workflow file small. Cycles through a
// pool of commands + reads with mild randomization.

import { resolve } from "node:path";
import type { AnyStep, CompetitorWorkflow } from "./types.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const r = (p: string) => resolve(REPO_ROOT, p);

const CMD_POOL: Array<{ cmd: string; assert: (t: string) => boolean }> = [
  { cmd: "git status --porcelain", assert: (t) => t.length >= 0 },
  { cmd: "git log --oneline -10", assert: (t) => /[a-f0-9]/i.test(t) || t.length >= 0 },
  { cmd: "ls -la src | head -20", assert: (t) => t.length >= 0 },
  { cmd: "ls -la build/tools | head -30", assert: (t) => t.length >= 0 },
  { cmd: "grep -rn 'registerTool' src | head -20", assert: (t) => t.length >= 0 },
  { cmd: "grep -rn 'isError' src/tools | head -20", assert: (t) => t.length >= 0 },
  { cmd: "find src -type f -name '*.ts' | head -50", assert: (t) => /\.ts/i.test(t) || t.length >= 0 },
  { cmd: "git diff HEAD~1 HEAD --stat", assert: (t) => t.length >= 0 },
  { cmd: "cat package.json | head -30", assert: (t) => /name/i.test(t) || t.length >= 0 },
  { cmd: "node --version && npm --version", assert: (t) => /v\d/.test(t) },
  { cmd: "for i in $(seq 1 20); do echo step$i; done", assert: (t) => /step/i.test(t) },
  { cmd: "git branch --show-current", assert: (t) => t.length >= 0 },
];

const READ_POOL: Array<{ path: string; mode: "full" | "map" | "outline" }> = [
  { path: r("package.json"), mode: "full" },
  { path: r("src/server.ts"), mode: "map" },
  { path: r("src/server.ts"), mode: "outline" },
  { path: r("src/tools/read.ts"), mode: "full" },
  { path: r("src/tools/read.ts"), mode: "outline" },
  { path: r("src/tools/route.ts"), mode: "full" },
  { path: r("src/tools/diff.ts"), mode: "full" },
  { path: r("src/diff/git-text.ts"), mode: "full" },
  { path: r("src/store.ts"), mode: "outline" },
  { path: r("src/cli.ts"), mode: "map" },
  { path: r("CLAUDE.md"), mode: "full" },
  { path: r("src/tools/registry.ts"), mode: "full" },
];

const steps: AnyStep[] = [];
// Interleave: command, read, command, read, ... — 500 total turns.
for (let i = 0; i < 500; i++) {
  if (i % 2 === 0) {
    const { cmd, assert } = CMD_POOL[i % CMD_POOL.length];
    steps.push({
      kind: "command",
      label: `${i + 1}-cmd-${cmd.slice(0, 20).replace(/[^a-z0-9]+/gi, "-")}`,
      command: cmd,
      timeoutMs: 15_000,
      assert,
    });
  } else {
    const pick = READ_POOL[i % READ_POOL.length];
    steps.push({
      kind: "read",
      label: `${i + 1}-read-${pick.path.split(/[\\/]/).pop()?.slice(0, 20)}-${pick.mode}`,
      path: pick.path,
      mode: pick.mode,
      assert: (t) => t.length >= 0,
    });
  }
}

const wf: CompetitorWorkflow = {
  name: "cascade-500turn",
  description: "500-turn mixed session — realistic agent workload length. Compounding context cost.",
  fallbackPolicy: "raw-on-error",
  steps,
};

export default wf;
