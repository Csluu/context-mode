// ctx_fetch_run parity. Lists / retrieves saved sidecar artifacts. Seed by
// running a ctx_execute that produces a sidecar, then list runs.

import type { McpStdioClient } from "../runner.js";
import { requireToolOk } from "../lib.js";
import type { Suite } from "../suite.js";

async function seed(client: McpStdioClient): Promise<void> {
  // ctx_execute with large output triggers sidecar storage.
  requireToolOk(await client.call("ctx_execute", {
    language: "javascript",
    code: `for (let i = 0; i < 300; i++) console.log("sidecar-seed-line " + i);`,
    intent: "sidecar seed",
  }), "ctx-fetch-run seed");
}

const suite: Suite = {
  name: "ctx-fetch-run",
  scenarios: [
    {
      tool: "ctx_fetch_run", name: "list", args: { list: true }, setup: seed,
      assert: (t) => t.length > 0 ? [] : [`fetch-run list empty`],
    },
    {
      tool: "ctx_fetch_run", name: "latest", args: { latest: true }, setup: seed,
      assert: (t) => t.length > 0 ? [] : [`fetch-run latest empty`],
    },
  ],
};

export default suite;
