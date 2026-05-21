// Phase 1.5 — ANSI / color stripping. Generate output with ESC[ codes. Tools
// that strip ANSI save bytes; tools that preserve them count the escape codes.

import type { CompetitorWorkflow } from "./types.js";

const PROG = `
const colors = ["\\x1b[31m", "\\x1b[32m", "\\x1b[33m", "\\x1b[34m", "\\x1b[36m"];
const reset = "\\x1b[0m";
for (let i = 0; i < 200; i++) {
  const c = colors[i % colors.length];
  console.log(c + "line " + i + " " + reset + "after-reset " + i);
}
console.log("\\x1b[1;31mERROR final marker\\x1b[0m");
`.replace(/\n/g, " ");

const wf: CompetitorWorkflow = {
  name: "ansi-stripping",
  description: "200 ANSI-colored lines. Tools that strip ANSI save bytes.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "command",
      label: "ansi-log",
      command: `node -e ${JSON.stringify(PROG)}`,
      timeoutMs: 15_000,
      assert: (t) => /ERROR|final|marker|line/i.test(t),
    },
  ],
};

export default wf;
