// Dim 4 — ctx_diff value suite. Measures compressed-diff bytes vs raw git diff.

import type { Suite } from "../suite.js";

const suite: Suite = {
  name: "value-diff",
  forkOnly: true,
  scenarios: [
    { tool: "ctx_diff", name: "head-vs-main", args: { from: "main", to: "HEAD" } },
    { tool: "ctx_diff", name: "head-vs-head-1", args: { from: "HEAD~1", to: "HEAD" } },
  ],
};

export default suite;
