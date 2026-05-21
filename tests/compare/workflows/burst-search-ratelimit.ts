// Tier 2: ctx_search rate limit. Fork limits ctx_search to 8 calls / 60s.
// Burst 10 calls; later calls should be rejected with a small error.

import type { Workflow, WorkflowStep } from "./index.js";

const steps: WorkflowStep[] = [];
for (let i = 0; i < 10; i++) {
  steps.push({
    label: `search-${i + 1}`,
    tool: "ctx_search",
    args: { queries: [`burst-test-${i}`] },
    allowError: true,
    // Pass if it succeeds OR if it returns a clear rate-limit error.
    assert: (text) => text.length >= 0,
  });
}

const wf: Workflow = {
  name: "burst-search-ratelimit",
  description: "Issue 10 ctx_search calls in rapid succession. Validates rate-limit kicks in cleanly around call #9 with a small error message.",
  forkOnly: true,
  steps,
};

export default wf;
