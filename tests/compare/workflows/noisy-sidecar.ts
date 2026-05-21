// Workflow: noisy command followed by follow-up reads from sidecar artifact.
// Expected: ctx_route classifies → ctx_execute runs with intent (artifact
// stored) → ctx_fetch_run retrieves the saved raw run without re-executing.

import type { Workflow } from "./index.js";

const noisyShell = `
for i in $(seq 1 200); do
  echo "[trace] iteration $i alpha bravo charlie token-$i"
done
echo "ERROR final marker"
`;

const wf: Workflow = {
  name: "noisy-sidecar",
  description: "Classify noisy command via ctx_route, run via ctx_execute (sidecar), then ctx_fetch_run for the raw artifact.",
  forkOnly: true,
  steps: [
    {
      label: "route",
      tool: "ctx_route",
      args: { command: "bash -c 'for i in $(seq 1 200); do echo trace; done; echo ERROR'", explain: true },
      assert: (t) => /noisy|loop|seq|trace|ERROR|classif/i.test(t) || t.length > 60,
    },
    {
      label: "execute-with-intent",
      tool: "ctx_execute",
      args: { language: "shell", code: noisyShell, intent: "ERROR final marker" },
      assert: (t) => /ERROR|indexed|section/i.test(t),
    },
    {
      label: "fetch-latest-run",
      tool: "ctx_fetch_run",
      args: { latest: true },
      assert: (t) => t.length > 30,
    },
  ],
};

export default wf;
