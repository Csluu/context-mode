// Tier 2: real refactor session. Read 3 files via ctx_read, then ctx_execute
// to propose a refactor based on what was read. Measures end-to-end cost.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const fStore = join(repoRoot, "src", "store.ts");
const fRuntime = join(repoRoot, "src", "runtime.ts");
const fServer = join(repoRoot, "src", "server.ts");

const wf: Workflow = {
  name: "multi-file-refactor",
  description: "Read three core source files via ctx_read outline, then ctx_execute analysis suggesting refactor targets.",
  forkOnly: true,
  steps: [
    { label: "read-store",   tool: "ctx_read", args: { path: fStore,   mode: "outline" }, assert: (t) => t.length > 100 },
    { label: "read-runtime", tool: "ctx_read", args: { path: fRuntime, mode: "outline" }, assert: (t) => t.length > 50 },
    { label: "read-server",  tool: "ctx_read", args: { path: fServer,  mode: "outline" }, assert: (t) => t.length > 100 },
    {
      label: "analyze",
      tool: "ctx_execute",
      args: {
        language: "javascript",
        code: `
const fs = require("node:fs");
const files = [${JSON.stringify(fStore)}, ${JSON.stringify(fRuntime)}, ${JSON.stringify(fServer)}];
let total = 0, exports = 0, classes = 0;
for (const f of files) {
  const buf = fs.readFileSync(f, "utf8");
  total += buf.length;
  exports += (buf.match(/export\\s+(function|class|const|interface)/g) || []).length;
  classes += (buf.match(/^class\\s|^export\\s+class\\s/gm) || []).length;
}
console.log("total bytes:", total);
console.log("exports:", exports);
console.log("classes:", classes);
console.log("suggestion: review largest file first");
`,
      },
      assert: (t) => /total bytes:\s*\d+/.test(t) && /exports:\s*\d+/.test(t),
    },
  ],
};

export default wf;
