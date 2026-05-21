// Workflow: check whether a token appears in a generated bundle.
// Expected: ctx_execute reads the bundle in-process and reports a count.
// Serena symbol nav is the wrong tool — generated code has no real symbols.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const bundle = join(repoRoot, "server.bundle.mjs");

const searchCode = `
const fs = require("node:fs");
const buf = fs.readFileSync(${JSON.stringify(bundle)}, "utf8");
const needles = ["ctx_diff", "ctx_route", "ctx_gain"];
for (const n of needles) {
  let i = 0, hits = 0;
  while ((i = buf.indexOf(n, i)) !== -1) { hits++; i += n.length; }
  console.log(n + ": " + hits + " occurrence(s)");
}
console.log("bundle bytes: " + buf.length);
`;

const wf: Workflow = {
  name: "bundle-search",
  description: "Count occurrences of ctx_diff / ctx_route / ctx_gain in server.bundle.mjs via ctx_execute.",
  forkOnly: true,
  steps: [
    { label: "count-tokens", tool: "ctx_execute", args: { language: "javascript", code: searchCode, intent: "ctx_* tool string occurrences in bundle" }, assert: (t) => /ctx_diff:\s*\d+/.test(t) && /bundle bytes:\s*\d+/.test(t) },
  ],
};

export default wf;
