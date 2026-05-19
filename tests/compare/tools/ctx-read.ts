// ctx_read suite — map | outline | symbols | slice.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Suite } from "../suite.js";

const fixture = join(repoRoot, "src", "executor.ts");

const suite: Suite = {
  name: "ctx-read",
  scenarios: [
    { tool: "ctx_read", name: "map-executor",     args: { path: fixture, mode: "map" } },
    { tool: "ctx_read", name: "outline-executor", args: { path: fixture, mode: "outline" } },
    { tool: "ctx_read", name: "symbols-executor", args: { path: fixture, mode: "symbols" } },
    { tool: "ctx_read", name: "slice-1-80",       args: { path: fixture, mode: "slice", start: 1, end: 80 } },
  ],
};

export default suite;
