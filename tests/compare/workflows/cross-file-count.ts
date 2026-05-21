// Workflow: count mentions of a tool name across docs + configs.
// Expected: ctx_execute computes exact files/lines; Serena is the wrong tool.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const code = `
const fs = require("node:fs");
const path = require("node:path");
const roots = [
  ${JSON.stringify(join(repoRoot, "docs"))},
  ${JSON.stringify(join(repoRoot, "configs"))},
];
const needle = "ctx_diff";
const hits = [];
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && /\\.(md|mdc|json|ya?ml|toml)$/.test(e.name)) {
      let buf;
      try { buf = fs.readFileSync(full, "utf8"); } catch { continue; }
      const lines = buf.split("\\n");
      const found = lines.filter(l => l.includes(needle)).length;
      if (found > 0) hits.push({ file: path.relative(${JSON.stringify(repoRoot)}, full), count: found });
    }
  }
}
for (const r of roots) walk(r);
hits.sort((a, b) => b.count - a.count);
console.log("files mentioning " + needle + ": " + hits.length);
for (const h of hits) console.log("  " + h.count + "  " + h.file);
const experimentalMentions = hits.filter(h => {
  const buf = fs.readFileSync(path.join(${JSON.stringify(repoRoot)}, h.file), "utf8");
  return /ctx_diff[^\\n]*experimental/i.test(buf);
});
console.log("\\n'ctx_diff experimental' references: " + experimentalMentions.length);
for (const h of experimentalMentions) console.log("  " + h.file);
`;

const wf: Workflow = {
  name: "cross-file-count",
  description: "Count ctx_diff mentions across docs/ and configs/, flag any 'ctx_diff experimental' wording that should be updated now that the tool is stable.",
  forkOnly: true,
  steps: [
    { label: "scan-docs-and-configs", tool: "ctx_execute", args: { language: "javascript", code, intent: "ctx_diff experimental references" }, assert: (t) => /files mentioning ctx_diff:\s*\d+/.test(t) && /experimental.+references:\s*\d+/.test(t) },
  ],
};

export default wf;
