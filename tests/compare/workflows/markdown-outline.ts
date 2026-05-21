// Workflow: read a markdown handoff doc. Outline then slice specific sections.
// Expected: ctx_read map/outline are the right primitive; Serena's symbol tools
// degrade or fail on prose.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const target = join(repoRoot, "docs", "FORK_HANDOFF.md");

const wf: Workflow = {
  name: "markdown-outline",
  description: "Read docs/FORK_HANDOFF.md: map → outline → slice. Tests ctx_read on prose where symbol tools are weak.",
  forkOnly: true,
  steps: [
    { label: "map",     tool: "ctx_read", args: { path: target, mode: "map" },     assert: (t) => /#|heading|section|lines|FORK/i.test(t) },
    { label: "outline", tool: "ctx_read", args: { path: target, mode: "outline" }, assert: (t) => /#|heading|section/i.test(t) || t.length > 100 },
    { label: "slice-head",   tool: "ctx_read", args: { path: target, mode: "slice", compact: true, start: 1, end: 60 },   assert: (t) => t.length > 50 },
    { label: "slice-middle", tool: "ctx_read", args: { path: target, mode: "slice", compact: true, start: 60, end: 140 }, assert: (t) => t.length > 50 },
  ],
};

export default wf;
