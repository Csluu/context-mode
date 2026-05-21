// ctx_stats parity suite (shared tool only). Runs after a small seeded
// workload so both sides have non-empty session counters. Compares
// returned shape (canonicalized). Numeric values are NOT directly compared
// because each side counts its own session bytes — see stat-validate.ts
// for cross-checked numerics. ctx_gain/ctx_discover are fork-only — see
// value-fork-diag.ts.

import type { McpStdioClient } from "../runner.js";
import { requireToolOk } from "../lib.js";
import type { Suite } from "../suite.js";

async function seed(client: McpStdioClient): Promise<void> {
  requireToolOk(await client.call("ctx_batch_execute", {
    commands: [
      { label: "seed-a", command: "echo 'stats-seed-alpha bravo charlie'" },
      { label: "seed-b", command: "echo 'stats-seed-delta echo foxtrot'" },
    ],
    queries: ["alpha"],
  }), "ctx-stats batch seed");
  requireToolOk(await client.call("ctx_search", { queries: ["delta"] }), "ctx-stats search seed");
  requireToolOk(
    await client.call("ctx_execute", { language: "javascript", code: `console.log("stats-seed-execute");` }),
    "ctx-stats execute seed",
  );
}

const suite: Suite = {
  name: "ctx-stats",
  scenarios: [
    {
      tool: "ctx_stats", name: "stats-default", args: {}, setup: seed,
      // Fork extends stats with project/session/lifetime scopes; upstream
      // returns a simpler per-tool table. Shape divergence is intentional.
      expectDivergence: true,
      canonicalize: (t) => t.replace(/\d+/g, "<N>"),
      assert: (t) => t.length > 0 ? [] : [`empty stats output`],
    },
  ],
};

export default suite;
