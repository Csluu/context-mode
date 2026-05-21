// Tier 1: compact ctx_read vs Serena on a generated bundle. Bundles have no
// meaningful symbols; ctx_execute with grep is the right tool.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const target = join(repoRoot, "server.bundle.mjs");

const wf: Workflow = {
  name: "compact-vs-serena-bundle",
  description: "ctx_read map on server.bundle.mjs (~770KB) then ctx_execute string search. Serena's symbol nav is meaningless on minified bundle.",
  forkOnly: true,
  steps: [
    {
      label: "map",
      tool: "ctx_read",
      args: { path: target, mode: "map" },
      assert: (text) => text.length > 50 && text.length < 50_000,
    },
    {
      label: "grep-ctx_diff",
      tool: "ctx_execute",
      args: {
        language: "javascript",
        code: `const fs = require("node:fs"); const buf = fs.readFileSync(${JSON.stringify(target)}, "utf8"); let i = 0, hits = 0; while ((i = buf.indexOf("ctx_diff", i)) !== -1) { hits++; i += 8; } console.log("ctx_diff hits:", hits);`,
      },
      assert: (text) => /ctx_diff hits:\s*[1-9]\d*/.test(text),
    },
  ],
};

export default wf;
