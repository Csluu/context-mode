// Workflow: ctx_diff with summary + risk emphasis on real history.
// Expected: even more compact than the default ctx_diff output.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "ctx-diff-summary",
  description: "Run ctx_diff in compact summary mode (summary=true, risk=true) on recent history. Measures the most-compressed diff output.",
  forkOnly: true,
  steps: [
    { label: "summary-head-vs-head-1", tool: "ctx_diff", args: { from: "HEAD~1", to: "HEAD", summary: true }, assert: (t) => t.length > 0 },
    { label: "summary-risk-head-vs-head-3", tool: "ctx_diff", args: { from: "HEAD~3", to: "HEAD", summary: true, risk: true }, assert: (t) => t.length > 0 },
  ],
};

export default wf;
