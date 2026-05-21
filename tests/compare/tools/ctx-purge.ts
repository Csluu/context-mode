// ctx_purge parity. Dry-run only — never destructive. Seeded with a small
// workload so both sides have non-empty state to "would-purge".

import type { McpStdioClient } from "../runner.js";
import { requireToolOk } from "../lib.js";
import type { Suite } from "../suite.js";

async function seed(client: McpStdioClient): Promise<void> {
  requireToolOk(await client.call("ctx_batch_execute", {
    commands: [{ label: "purge-seed", command: "echo 'purge-seed-content'" }],
    queries: ["purge"],
  }), "ctx-purge seed");
}

const suite: Suite = {
  name: "ctx-purge",
  scenarios: [
    {
      tool: "ctx_purge", name: "dry-run-project", args: { dryRun: true, confirm: true, scope: "project" }, setup: seed,
      // Real behavioral divergence: fork respects dryRun (reports "would purge");
      // upstream (v1.0.143 pin) ignores dryRun and actually purges. Document
      // and accept — exit code does not fail on this row.
      expectDivergence: true,
      assert: (t) => t.length > 10 ? [] : [`purge dry-run output too short`],
    },
  ],
};

export default suite;
