// Workflow: compare AGENTS.md routing rules across two adapters.
// Expected: ctx_read both files, then ctx_execute to diff/extract headings.
// Serena returns empty/junk on markdown.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const codex = join(repoRoot, "configs", "codex", "AGENTS.md");
const openclaw = join(repoRoot, "configs", "openclaw", "AGENTS.md");

const diffCode = `
const fs = require("node:fs");
const a = fs.readFileSync(${JSON.stringify(codex)}, "utf8").split("\\n");
const b = fs.readFileSync(${JSON.stringify(openclaw)}, "utf8").split("\\n");
const ah = new Set(a.filter(l => /^#{1,3} /.test(l)));
const bh = new Set(b.filter(l => /^#{1,3} /.test(l)));
const onlyA = [...ah].filter(x => !bh.has(x));
const onlyB = [...bh].filter(x => !ah.has(x));
console.log("codex-only headings:", onlyA.length);
for (const h of onlyA) console.log("  + " + h);
console.log("openclaw-only headings:", onlyB.length);
for (const h of onlyB) console.log("  - " + h);
`;

const wf: Workflow = {
  name: "instruction-config",
  description: "Read both AGENTS.md files (codex + openclaw) then run ctx_execute to compare heading sets.",
  forkOnly: true,
  steps: [
    { label: "read-codex-outline", tool: "ctx_read", args: { path: codex, mode: "outline" }, assert: (t) => /#|heading|codex|AGENTS/i.test(t) || t.length > 80 },
    { label: "read-openclaw-outline", tool: "ctx_read", args: { path: openclaw, mode: "outline" }, assert: (t) => /#|heading|openclaw|AGENTS/i.test(t) || t.length > 80 },
    { label: "diff-headings", tool: "ctx_execute", args: { language: "javascript", code: diffCode, intent: "heading differences" }, assert: (t) => /codex-only|openclaw-only|headings:\s*\d+/.test(t) },
  ],
};

export default wf;
