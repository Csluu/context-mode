// Tier 2: extract specific JSON fields via ctx_execute vs raw cat.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const pkg = join(repoRoot, "package.json");

const wf: Workflow = {
  name: "json-extract-deps",
  description: "Extract dependency names + counts from package.json via ctx_execute. Should be tiny vs cat package.json.",
  forkOnly: true,
  steps: [
    {
      label: "extract-deps",
      tool: "ctx_execute",
      args: {
        language: "javascript",
        code: `
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync(${JSON.stringify(pkg)}, "utf8"));
const deps = Object.keys(p.dependencies || {}).sort();
const dev = Object.keys(p.devDependencies || {}).sort();
console.log("dep count:", deps.length);
console.log("dev count:", dev.length);
console.log("deps:", deps.join(", "));
console.log("devDeps:", dev.join(", "));
`,
      },
      assert: (t) => /dep count:\s*\d+/.test(t) && /dev count:\s*\d+/.test(t) && t.includes("zod"),
    },
  ],
};

export default wf;
