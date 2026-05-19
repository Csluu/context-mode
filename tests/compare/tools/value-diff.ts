// Dim 4 — ctx_diff value suite. Fork-only experimental tool (gated by
// CTX_MODE_EXPERIMENTAL=1). Measures compressed-diff bytes vs raw git diff.

import type { Suite } from "../suite.js";

const suite: Suite = {
  name: "value-diff",
  forkOnly: true,
  env: { CTX_MODE_EXPERIMENTAL: "1", CONTEXT_MODE_EXPERIMENTAL: "1" },
  scenarios: [
    { tool: "ctx_diff", name: "head-vs-main", args: { from: "main", to: "HEAD" } },
    { tool: "ctx_diff", name: "head-vs-head-1", args: { from: "HEAD~1", to: "HEAD" } },
  ],
};

export default suite;
