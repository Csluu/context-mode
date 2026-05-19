// Workflow: explore an unfamiliar codebase.
//   read(map) → read(outline) → read(symbols) → search(symbol name) → read(slice)

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow, WorkflowContext } from "./index.js";

const target = join(repoRoot, "src", "store.ts");

const wf: Workflow = {
  name: "codebase-explore",
  description: "Explore src/store.ts: map → outline → symbols → search for ContentStore → slice the relevant region.",
  steps: [
    { label: "map",     tool: "ctx_read", args: { path: target, mode: "map" } },
    { label: "outline", tool: "ctx_read", args: { path: target, mode: "outline" } },
    { label: "symbols", tool: "ctx_read", args: { path: target, mode: "symbols" } },
    { label: "search",  tool: "ctx_search", args: { queries: ["ContentStore", "search", "index"] } },
    {
      label: "slice",
      tool: "ctx_read",
      args: (_ctx: WorkflowContext) => ({ path: target, mode: "slice", start: 1, end: 120 }),
    },
  ],
};

export default wf;
