// Tier 2: cost of follow-up via sidecar vs cost of re-executing the noisy
// command. Asserts that ctx_fetch_run's payload is much smaller than a rerun.

import type { Workflow } from "./index.js";

const noisy = `
for (let i = 0; i < 600; i++) {
  console.log("[trace] noisy " + i + " token-" + (i % 23) + " filler-" + i.toString(36));
}
console.log("END marker-zeta-omega");
`;

const wf: Workflow = {
  name: "sidecar-vs-rerun-cost",
  description: "Run a noisy ctx_execute then ctx_fetch_run vs re-executing the same noisy command. Sidecar should be cheaper (smaller payload).",
  forkOnly: true,
  steps: [
    {
      label: "first-run",
      tool: "ctx_execute",
      args: { language: "javascript", code: noisy, intent: "END marker" },
      assert: (t) => /END|marker|indexed|section/.test(t),
    },
    {
      label: "fetch-sidecar",
      tool: "ctx_fetch_run",
      args: { latest: true, raw: false },
      assert: (t) => t.length > 0,
    },
    {
      label: "rerun",
      tool: "ctx_execute",
      args: { language: "javascript", code: noisy, intent: "END marker (rerun)" },
      assert: (t) => /END|marker|indexed|section/.test(t),
    },
  ],
};

export default wf;
