// Phase 1.5 — Massive diff. git diff over a wide commit range producing a
// large raw diff. Tests fork's ctx_diff semantic+risk modes vs other tools'
// raw passthrough.

import type { CompetitorWorkflow } from "./types.js";

const wf: CompetitorWorkflow = {
  name: "massive-diff",
  description: "git diff HEAD~20 HEAD — large diff. Fork ctx_diff vs others' raw passthrough.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "command",
      label: "diff-head20-full",
      command: "git diff HEAD~20 HEAD",
      timeoutMs: 30_000,
      assert: (t) => t.length >= 0,
    },
    {
      kind: "command",
      label: "diff-head20-stat",
      command: "git diff HEAD~20 HEAD --stat",
      timeoutMs: 30_000,
      assert: (t) => t.length >= 0,
    },
    {
      kind: "command",
      label: "diff-head20-namestatus",
      command: "git diff HEAD~20 HEAD --name-status",
      timeoutMs: 30_000,
      assert: (t) => t.length >= 0,
    },
    {
      kind: "command",
      label: "diff-head5-full",
      command: "git diff HEAD~5 HEAD",
      timeoutMs: 20_000,
      assert: (t) => t.length >= 0,
    },
  ],
};

export default wf;
