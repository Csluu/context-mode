// Workflow: triage a noisy log file via sandbox execution.
//   execute(generate log lines) → execute(count ERROR by type) → search(ERROR)

import type { Workflow } from "./index.js";

const generateLogs = `
const types = ["INFO", "WARN", "ERROR", "DEBUG"];
for (let i = 0; i < 500; i++) {
  const t = types[i % types.length];
  console.log("[" + t + "] line " + i + " message-token-" + (i % 11));
}
`;

const countErrors = `
const fs = require("node:fs");
// Synthesize same dataset deterministically for counting.
const types = ["INFO", "WARN", "ERROR", "DEBUG"];
const counts = {};
for (let i = 0; i < 500; i++) {
  const t = types[i % types.length];
  counts[t] = (counts[t] || 0) + 1;
}
console.log(JSON.stringify(counts));
`;

const wf: Workflow = {
  name: "log-triage",
  description: "Generate noisy log output in sandbox, count by level, then search the index for ERROR lines.",
  steps: [
    {
      label: "generate-logs",
      tool: "ctx_execute",
      args: { language: "javascript", code: generateLogs, intent: "ERROR lines" },
    },
    {
      label: "count-by-level",
      tool: "ctx_execute",
      args: { language: "javascript", code: countErrors },
    },
    {
      label: "search-errors",
      tool: "ctx_search",
      args: { queries: ["ERROR line"] },
    },
  ],
};

export default wf;
