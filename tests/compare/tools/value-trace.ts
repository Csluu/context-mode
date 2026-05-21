// Dim 4 — ctx_trace value suite. Fork-only experimental tool. Returns
// summarized session activity. Measures summary bytes after a small
// scripted workload.

import type { McpStdioClient } from "../runner.js";
import { requireToolOk } from "../lib.js";
import type { Suite } from "../suite.js";

async function seed(client: McpStdioClient): Promise<void> {
  requireToolOk(await client.call("ctx_batch_execute", {
    commands: [
      { label: "trace-1", command: "echo 'trace-seed-alpha'" },
      { label: "trace-2", command: "echo 'trace-seed-bravo'" },
    ],
    queries: ["alpha"],
  }), "value-trace batch seed");
  requireToolOk(await client.call("ctx_search", { queries: ["bravo"] }), "value-trace search seed");
  requireToolOk(
    await client.call("ctx_execute", { language: "javascript", code: `console.log("trace-seed-exec");` }),
    "value-trace execute seed",
  );
}

const suite: Suite = {
  name: "value-trace",
  forkOnly: true,
  env: { CTX_MODE_EXPERIMENTAL: "1", CONTEXT_MODE_EXPERIMENTAL: "1" },
  scenarios: [
    {
      tool: "ctx_trace", name: "summary-default", args: {}, setup: seed,
      // Without the session hooks installed (PreToolUse/PostToolUse), the
      // session DB isn't created — ctx_trace correctly returns "missing-db"
      // with isError:true. Accept either successful trace OR explicit
      // missing-db response. expectDivergence permits the error-state.
      expectDivergence: true,
      assert: (t) => /spans:|missing-db/.test(t) ? [] : [`trace returned unexpected output (got: ${t.slice(0, 100)})`],
    },
  ],
};

export default suite;
