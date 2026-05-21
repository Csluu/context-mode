// Workflow: explore an unfamiliar codebase.
//   read(map) → read(outline) → read(symbols) → search(symbol name) → read(slice)

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow, WorkflowContext } from "./index.js";

const target = join(repoRoot, "src", "store.ts");

const wf: Workflow = {
  name: "codebase-explore",
  description: "Explore src/store.ts: map → outline → symbols → search for ContentStore → slice the relevant region.",
  forkOnly: true, // ctx_read is fork-only
  steps: [
    { label: "map",     tool: "ctx_read", args: { path: target, mode: "map" },     assert: (t) => /store|class|export|function/i.test(t) },
    { label: "outline", tool: "ctx_read", args: { path: target, mode: "outline" }, assert: (t) => /ContentStore|class|export|function/i.test(t) },
    { label: "symbols", tool: "ctx_read", args: { path: target, mode: "symbols" }, assert: (t) => /ContentStore|class|function/i.test(t) },
    { label: "search",  tool: "ctx_search", args: { queries: ["ContentStore", "search", "index"] }, assert: (t) => /ContentStore/i.test(t) },
    {
      label: "slice",
      tool: "ctx_read",
      args: (_ctx: WorkflowContext) => ({ path: target, mode: "slice", compact: true, start: 374, end: 460 }),
      assert: (t) => /export class ContentStore|OPTIMIZE_EVERY|stmtSearch/.test(t),
    },
  ],
};

export default wf;
