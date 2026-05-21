// Workflow: extract registered tool names from a bundle.
// Expected: ctx_execute parses bundle text and prints the list. Serena cannot.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const bundle = join(repoRoot, "server.bundle.mjs");

const extractCode = `
const fs = require("node:fs");
const buf = fs.readFileSync(${JSON.stringify(bundle)}, "utf8");
const re = /name:\\s*"(ctx_[a-z_]+)"/g;
const found = new Set();
let m;
while ((m = re.exec(buf)) !== null) found.add(m[1]);
const sorted = [...found].sort();
console.log("registered ctx_* tools: " + sorted.length);
for (const t of sorted) console.log("  " + t);
console.log("ctx_diff present? " + sorted.includes("ctx_diff"));
`;

const wf: Workflow = {
  name: "bundle-tool-list",
  description: "Extract registered ctx_* tool names from server.bundle.mjs and verify ctx_diff is present.",
  forkOnly: true,
  steps: [
    { label: "extract-tools", tool: "ctx_execute", args: { language: "javascript", code: extractCode, intent: "ctx_* tool registry from bundle" }, assert: (t) => /registered ctx_\* tools:\s*\d+/.test(t) && /ctx_diff present\?\s*true/i.test(t) },
  ],
};

export default wf;
