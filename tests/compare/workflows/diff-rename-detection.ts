// Tier 2: ctx_diff on a recent history range; rename surfaces if any happened.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "diff-rename-detection",
  description: "ctx_diff HEAD~10..HEAD with semantic + summary. If any rename happened in recent history, the semantic groups should surface it.",
  forkOnly: true,
  steps: [
    {
      label: "diff-recent",
      tool: "ctx_diff",
      args: { from: "HEAD~10", to: "HEAD", semantic: true, summary: true },
      assert: (t) => t.length > 0,
    },
  ],
};

export default wf;
