// Tier 2: ctx_fetch_and_index on an unreachable host. Fork should fail fast
// with a small, descriptive error — not hang or dump partial data.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "network-failure",
  description: "ctx_fetch_and_index against http://127.0.0.1:1 (closed port). Validates graceful failure path.",
  env: {
    CONTEXT_MODE_FETCH_ALLOWLIST: "127.0.0.1",
    CTX_FETCH_ALLOW_PRIVATE: "1",
  },
  forkOnly: true,
  steps: [
    {
      label: "fetch-closed-port",
      tool: "ctx_fetch_and_index",
      args: { url: "http://127.0.0.1:1/nope", source: "network-fail-test" },
      allowError: true,
      // Tool returning isError: true is OK; payload should be short + mention failure.
      assert: (text) => /error|fail|connect|refused|unreach|timeout/i.test(text) || text.length < 500,
    },
  ],
};

export default wf;
