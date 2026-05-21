// Tier 2: ctx_execute infinite loop with low timeout. Fork should kill the
// process and return a short timeout marker, not stream unbounded output.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "timeout-truncation",
  description: "Run ctx_execute with a tight loop and explicit timeout. Validates timeout truncation path.",
  forkOnly: true,
  steps: [
    {
      label: "infinite-loop",
      tool: "ctx_execute",
      args: {
        language: "javascript",
        code: `let i = 0; while (true) { console.log("line " + i++); if (i > 1e7) break; }`,
        timeout: 1500,
      },
      assert: (t) => /timeout|truncat|killed|terminated|exceed/i.test(t) || t.length < 10_000,
    },
  ],
};

export default wf;
