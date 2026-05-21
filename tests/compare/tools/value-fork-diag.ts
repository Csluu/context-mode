// Fork-only diagnostic tools: ctx_gain + ctx_discover. Upstream
// (v1.0.143 pin) doesn't expose either. Runs fork-only, records bytes
// to quantify what fork adds to the diag surface.

import type { McpStdioClient } from "../runner.js";
import { requireToolOk } from "../lib.js";
import type { Suite } from "../suite.js";

async function seed(client: McpStdioClient): Promise<void> {
  requireToolOk(await client.call("ctx_batch_execute", {
    commands: [
      { label: "diag-a", command: "echo 'diag-seed-alpha'" },
      { label: "diag-b", command: "echo 'diag-seed-bravo'" },
    ],
    queries: ["alpha"],
  }), "value-fork-diag seed");
  requireToolOk(await client.call("ctx_search", { queries: ["bravo"] }), "value-fork-diag search seed");
  requireToolOk(
    await client.call("ctx_execute", { language: "javascript", code: `console.log("diag-exec");` }),
    "value-fork-diag execute seed",
  );
}

const suite: Suite = {
  name: "value-fork-diag",
  forkOnly: true,
  scenarios: [
    {
      tool: "ctx_gain", name: "gain-default", args: {}, setup: seed,
      canonicalize: (t) => t.replace(/\d+/g, "<N>"),
      assert: (t) => t.length > 0 ? [] : [`empty gain output`],
    },
    {
      tool: "ctx_discover", name: "discover-default", args: {}, setup: seed,
      canonicalize: (t) => t.replace(/\d+/g, "<N>"),
      assert: (t) => t.length > 0 ? [] : [`empty discover output`],
    },
  ],
};

export default suite;
