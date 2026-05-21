// Tier 1: ctx_diff vs raw git diff variants. Measures ctx_diff in default,
// summary, and stat-flavored modes against raw `git diff` outputs.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "ctx-diff-stat-variants",
  description: "Run ctx_diff in default / summary / risk modes on HEAD~3..HEAD. Compare against raw git diff, --stat, --name-status (raw side via workflow-raw-baseline).",
  forkOnly: true,
  steps: [
    {
      label: "ctx-diff-default",
      tool: "ctx_diff",
      args: { from: "HEAD~3", to: "HEAD" },
      assert: (text) => text.length > 0 && (text.includes("file") || text.includes("change") || text.includes("diff")),
    },
    {
      label: "ctx-diff-summary",
      tool: "ctx_diff",
      args: { from: "HEAD~3", to: "HEAD", summary: true },
      assert: (text) => text.length > 0 && (text.includes("file") || text.includes("summary") || text.includes("change") || text.includes("group")),
    },
    {
      label: "ctx-diff-risk",
      tool: "ctx_diff",
      args: { from: "HEAD~3", to: "HEAD", summary: true, risk: true },
      assert: (text) => text.length > 0,
    },
  ],
};

export default wf;
