// Workflow: react to a failing test.
//   execute(vitest --reporter=json simulated) → search(FAIL) → read(slice of failing file)

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const simulateVitest = `
const failures = [
  { file: "tests/store.test.ts", name: "ContentStore stores rows", err: "Expected 1, received 0" },
  { file: "tests/runtime.test.ts", name: "detects bun runtime", err: "missing runtime" },
];
console.log("[vitest] running...");
for (const f of failures) {
  console.log("FAIL  " + f.file + " > " + f.name);
  console.log("       AssertionError: " + f.err);
}
console.log("[vitest] 2 failed | 47 passed");
`;

const wf: Workflow = {
  name: "debug-test",
  description: "Simulate vitest output via sandbox, search for FAIL markers, read the implicated file's outline.",
  steps: [
    {
      label: "simulate-vitest",
      tool: "ctx_execute",
      args: { language: "javascript", code: simulateVitest, intent: "failing tests" },
    },
    {
      label: "search-fail",
      tool: "ctx_search",
      args: { queries: ["FAIL", "AssertionError"] },
    },
    {
      label: "read-store-outline",
      tool: "ctx_read",
      args: { path: join(repoRoot, "src", "store.ts"), mode: "outline" },
    },
  ],
};

export default wf;
