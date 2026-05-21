// Workflow: large doc, find one section by heading.
// Expected: ctx_read outline (cheap heading map) then narrow slice. Avoids
// dumping the whole 72KB file.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const target = join(repoRoot, "docs", "rtk-inspired-context-mode-spec - Copy.md");

const wf: Workflow = {
  name: "large-file-slice",
  description: "Find one section in a ~72KB design doc via outline then targeted slice.",
  forkOnly: true,
  steps: [
    { label: "outline",      tool: "ctx_read", args: { path: target, mode: "outline" },                          assert: (t) => /#|heading|section/i.test(t) || t.length > 100 },
    { label: "slice-early",  tool: "ctx_read", args: { path: target, mode: "slice", compact: true, start: 1,   end: 120 },      assert: (t) => t.length > 50 },
    { label: "slice-middle", tool: "ctx_read", args: { path: target, mode: "slice", compact: true, start: 400, end: 520 },      assert: (t) => t.length > 50 },
  ],
};

export default wf;
