// Tier 1: compact ctx_read vs Serena on JSON. Serena has no real symbol model
// for JSON; ctx_read map/outline should produce a useful structural summary.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const target = join(repoRoot, "package.json");

const wf: Workflow = {
  name: "compact-vs-serena-json",
  description: "ctx_read map/outline + ctx_execute deps-extract on package.json. JSON is non-code so Serena's symbol tools are weak.",
  forkOnly: true,
  steps: [
    {
      label: "map",
      tool: "ctx_read",
      args: { path: target, mode: "map" },
      assert: (text) => text.includes("package.json") || text.includes("name") || text.includes("dependencies") || text.length > 100,
    },
    {
      label: "outline",
      tool: "ctx_read",
      args: { path: target, mode: "outline" },
      assert: (text) => text.length > 50,
    },
    {
      label: "extract-deps",
      tool: "ctx_execute",
      args: {
        language: "javascript",
        code: `const fs = require("node:fs"); const p = JSON.parse(fs.readFileSync(${JSON.stringify(target)}, "utf8")); console.log("deps:", Object.keys(p.dependencies || {}).length); console.log("devDeps:", Object.keys(p.devDependencies || {}).length); console.log("zod present:", "zod" in (p.dependencies || {}));`,
      },
      assert: (text) => /deps:\s*\d+/.test(text) && /zod present: true/.test(text),
    },
  ],
};

export default wf;
