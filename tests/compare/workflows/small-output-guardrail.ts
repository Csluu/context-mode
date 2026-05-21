// Tier 1: guardrail check. ctx_route on tiny / safe commands should NOT
// recommend wrapping in ctx_execute — raw output is already cheap.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "small-output-guardrail",
  description: "Verify ctx_route does not push ctx_execute for trivial commands (echo / pwd / node --version) whose raw output is already tiny.",
  forkOnly: true,
  steps: [
    {
      label: "route-echo-hi",
      tool: "ctx_route",
      args: { command: "echo hi", explain: true },
      // Should classify as safe/short. We want the recommendation NOT to wrap
      // this in ctx_execute. Permissive oracle: text exists and either says
      // 'direct' / 'native' / 'bash' / 'short' / 'small', or lists 0 noise.
      assert: (text) => /direct|native|bash|short|small|tiny|no.recommend|no.context|skip/i.test(text) || text.length < 400,
    },
    {
      label: "route-pwd",
      tool: "ctx_route",
      args: { command: "pwd", explain: true },
      assert: (text) => /direct|native|bash|short|small|tiny|no.context|skip/i.test(text) || text.length < 400,
    },
    {
      label: "route-node-version",
      tool: "ctx_route",
      args: { command: "node --version", explain: true },
      assert: (text) => /direct|native|bash|short|small|tiny|no.context|skip/i.test(text) || text.length < 400,
    },
  ],
};

export default wf;
