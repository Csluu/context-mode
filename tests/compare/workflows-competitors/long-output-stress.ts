// Phase 1.5 — Long output stress. Generate a synthetic 10MB log via node -e
// and triage for the ERROR line. Tools that cap/index/sidecar win; tools that
// passthrough lose hard.

import type { CompetitorWorkflow } from "./types.js";

const PROG = `
let n = 200000;
for (let i = 0; i < n; i++) {
  console.log("[INFO] " + i + " ordinary line about widget-" + (i % 53));
  if (i === 137337) console.log("[ERROR] CRITICAL: marker-token-needle CONFIG=bad reason=missing-env");
}
console.log("[END] done " + n + " lines");
`.replace(/\n/g, " ");

const wf: CompetitorWorkflow = {
  name: "long-output-stress",
  description: "Generate ~10MB synthetic log. Triage for ERROR. Tests truncation + indexing.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "command",
      label: "huge-log-gen",
      command: `node -e ${JSON.stringify(PROG)}`,
      timeoutMs: 90_000,
      assert: (t) => /ERROR|CRITICAL|marker-token|END/i.test(t) || t.length > 1000,
    },
  ],
};

export default wf;
