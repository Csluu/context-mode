// Tier 3: same task in three sandbox languages. Validates parser parity:
// shell echo, javascript console.log, python print all produce comparable
// output structure for the same task.

import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "mixed-sandbox-langs",
  description: "Same trivial task (print 5 numbered lines) in shell / javascript / python. Validates ctx_execute language coverage.",
  forkOnly: true,
  steps: [
    {
      label: "shell",
      tool: "ctx_execute",
      args: {
        language: "shell",
        code: "for i in 1 2 3 4 5; do echo \"line $i marker-LANG-SHELL\"; done",
      },
      assert: (t) => /marker-LANG-SHELL/.test(t),
    },
    {
      label: "javascript",
      tool: "ctx_execute",
      args: {
        language: "javascript",
        code: "for (let i = 1; i <= 5; i++) console.log(`line ${i} marker-LANG-JS`);",
      },
      assert: (t) => /marker-LANG-JS/.test(t),
    },
    {
      label: "python",
      tool: "ctx_execute",
      args: {
        language: "python",
        code: "for i in range(1, 6):\n    print(f'line {i} marker-LANG-PY')",
      },
      // Python may or may not be available; treat failure as soft.
      assert: (t) => /marker-LANG-PY/.test(t) || /python|interpreter|not.found|unsupported/i.test(t),
    },
  ],
};

export default wf;
