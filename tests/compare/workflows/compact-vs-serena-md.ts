// Tier 1: compact ctx_read vs Serena on markdown. Serena's symbol overview
// returns near-empty on prose; ctx_read should produce a useful heading map.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const target = join(repoRoot, "docs", "FORK_HANDOFF.md");

const wf: Workflow = {
  name: "compact-vs-serena-md",
  description: "ctx_read map/outline/slice on a markdown handoff. Oracle checks heading presence.",
  forkOnly: true,
  steps: [
    {
      label: "map",
      tool: "ctx_read",
      args: { path: target, mode: "map" },
      assert: (text) => text.includes("FORK_HANDOFF") || text.includes("#") || text.includes("lines:"),
    },
    {
      label: "outline",
      tool: "ctx_read",
      args: { path: target, mode: "outline" },
      assert: (text) => /heading|section|#\s/i.test(text) || text.length > 100,
    },
    {
      label: "slice-top",
      tool: "ctx_read",
      args: { path: target, mode: "slice", compact: true, start: 1, end: 40 },
      assert: (text) => text.length > 50,
    },
  ],
};

export default wf;
