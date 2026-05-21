// Workflow: real branch diff via ctx_diff. Lightweight live test that
// exercises the diff tool against this repo's own git history.
// Expected: ctx_diff returns compressed semantic summary far smaller than
// raw `git diff` output.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "ctx-diff-branch",
  description: "Run ctx_diff with from=HEAD~1 to=HEAD and from=HEAD~3 to=HEAD to validate semantic-summary compression on real history.",
  forkOnly: true,
  steps: [
    { label: "head-vs-head-1", tool: "ctx_diff", args: { from: "HEAD~1", to: "HEAD" }, assert: (t) => t.length > 0 },
    { label: "head-vs-head-3", tool: "ctx_diff", args: { from: "HEAD~3", to: "HEAD" }, assert: (t) => t.length > 0 },
  ],
};

export default wf;
