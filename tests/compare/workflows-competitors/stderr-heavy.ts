// Phase 1.5 — Stderr-heavy command. Node emits a warning + spam to stderr.
// Tools that count stderr show realistic bytes; tools that drop stderr lie.

import type { CompetitorWorkflow } from "./types.js";

const PROG = `
console.warn("[WARN] deprecation notice: foo is going away in v2");
for (let i = 0; i < 100; i++) {
  process.stderr.write("[STDERR] noisy line " + i + " token-bravo-" + i + "\\n");
  process.stdout.write("[STDOUT] result line " + i + "\\n");
}
process.stderr.write("[STDERR] final warning marker\\n");
console.log("[STDOUT] DONE");
`.replace(/\n/g, " ");

const wf: CompetitorWorkflow = {
  name: "stderr-heavy",
  description: "Command emits 100 stderr lines + 100 stdout lines. Tests stderr accounting.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "command",
      label: "stderr-stdout-mix",
      command: `node -e ${JSON.stringify(PROG)}`,
      timeoutMs: 15_000,
      assert: (t) => /WARN|STDERR|STDOUT|DONE/i.test(t),
    },
  ],
};

export default wf;
