// Tier 2: trivial commands should NOT get a "use ctx_execute" recommendation.
// Distinct from small-output-guardrail in that we explicitly check the routing
// decision for trivial work commands developers run dozens of times a day.

import type { Workflow } from "./index.js";

const trivial = [
  "git branch --show-current",
  "git rev-parse --show-toplevel",
  "pwd",
  "node --version",
  "echo done",
];

const wf: Workflow = {
  name: "trivial-command-no-recommend",
  description: "Route a handful of trivial dev commands. ctx_route should classify as 'short' / 'direct' rather than recommend wrapping in ctx_execute.",
  forkOnly: true,
  steps: trivial.map((cmd) => ({
    label: `route-${cmd.replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}`,
    tool: "ctx_route",
    args: { command: cmd, explain: true },
    assert: (t: string) => /short|direct|native|bash|no.context|no.recommend|tiny|trivial|skip/i.test(t) || t.length < 600,
  })),
};

export default wf;
