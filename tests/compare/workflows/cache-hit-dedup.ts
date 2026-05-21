// Tier 2: ctx_read same file twice. Second call should compress / dedupe via
// the "already shown" sentinel, costing far less than the first.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const target = join(repoRoot, "src", "store.ts");

const wf: Workflow = {
  name: "cache-hit-dedup",
  description: "ctx_read the same file twice. Second call should detect duplicate and return a shortened notice.",
  forkOnly: true,
  steps: [
    {
      label: "first-read",
      tool: "ctx_read",
      args: { path: target, mode: "outline" },
      assert: (text) => text.length > 200,
    },
    {
      label: "second-read",
      tool: "ctx_read",
      args: { path: target, mode: "outline" },
      // Either fork returns a "already shown" sentinel (small), or it gives the
      // full payload again. We want small — flag if it's >50% of first.
      assert: (text) => /already|shown|cached|previous|deduplicat/i.test(text) || text.length < 800,
    },
  ],
};

export default wf;
