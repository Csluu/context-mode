// ctx_stats / ctx_gain / ctx_discover parity suite. Runs after a small
// seeded workload so both sides have non-empty session counters. Compares
// returned shape (canonicalized). Numeric values are NOT directly compared
// because both sides count their own session bytes — see stat-validate.ts
// for cross-checked numerics.

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
    { tool: "ctx_stats",    name: "stats-default", args: {}, setup: seed,
      canonicalize: (t) => t.replace(/\d+/g, "<N>") },
    { tool: "ctx_gain",     name: "gain-default",  args: {}, setup: seed,
      canonicalize: (t) => t.replace(/\d+/g, "<N>") },
    { tool: "ctx_discover", name: "discover-default", args: {}, setup: seed,
      canonicalize: (t) => t.replace(/\d+/g, "<N>") },
  ],
};

export default suite;
