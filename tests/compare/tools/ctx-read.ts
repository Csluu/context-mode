// ctx_read suite — map | outline | symbols | slice.
// Fork-only: upstream (v1.0.143 pin) does not expose ctx_read.
//
// freshClientPerScenario: fork dedupes repeat reads within a session — iter 2+
// returns a shortened "already shown" notice. Fresh client + iterations:1 +
// warmups:0 gives a clean single-shot measurement per mode.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Suite } from "../suite.js";

const fixture = join(repoRoot, "tests", "compare", "fixtures", "pinned-executor.ts");

const suite: Suite = {
  name: "ctx-read",
  forkOnly: true,
  freshClientPerScenario: true,
  scenarios: [
    {
      tool: "ctx_read", name: "map-executor", args: { path: fixture, mode: "map" },
      iterations: 1, warmups: 0,
      assert: (t) => t.includes("PolyglotExecutor") ? [] : [`missing PolyglotExecutor in map`],
    },
    {
      tool: "ctx_read", name: "outline-executor", args: { path: fixture, mode: "outline" },
      iterations: 1, warmups: 0,
      assert: (t) => t.includes("PolyglotExecutor") ? [] : [`missing PolyglotExecutor in outline`],
    },
    {
      tool: "ctx_read", name: "symbols-executor", args: { path: fixture, mode: "symbols" },
      iterations: 1, warmups: 0,
      assert: (t) => t.includes("PolyglotExecutor") ? [] : [`missing PolyglotExecutor in symbols`],
    },
    {
      tool: "ctx_read", name: "slice-1-80", args: { path: fixture, mode: "slice", compact: true, start: 1, end: 80 },
      iterations: 1, warmups: 0,
      assert: (t) => t.length > 100 ? [] : [`slice 1-80 too short (${t.length}B)`],
    },
  ],
};

export default suite;
