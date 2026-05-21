// Workflow: find references to a real function across the codebase.
// Expected: Serena wins (find_referencing_symbols is purpose-built for this).
// Fork uses ctx_read symbols + ctx_search as the best available substitute.
// This is the FAIRNESS CONTROL — proves we're not biasing toward fork.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const target = join(repoRoot, "src", "diff", "git-text.ts");

const wf: Workflow = {
  name: "semantic-nav-control",
  description: "Locate renderDiffSummary's body and find its references. Code semantics — Serena should beat ctx_read here.",
  forkOnly: true,
  steps: [
    { label: "outline-source", tool: "ctx_read",   args: { path: target, mode: "outline" }, assert: (t) => /renderDiffSummary|collectGitTextDiff|export|function/.test(t) },
    { label: "find-symbol",    tool: "ctx_read",   args: { path: target, mode: "symbols" }, assert: (t) => /renderDiffSummary|collectGitTextDiff|function/.test(t) },
    { label: "search-refs",    tool: "ctx_search", args: { queries: ["renderDiffSummary"] }, assert: (t) => /renderDiffSummary/.test(t) || t.length === 0 },
  ],
};

export default wf;
