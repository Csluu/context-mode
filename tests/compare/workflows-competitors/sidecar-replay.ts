// Phase 1.5 — Sidecar replay. Fork ctx_execute with intent writes a sidecar
// artifact. Subsequent queries find content WITHOUT rerunning the noisy command.
// Other tools have no replay path — they would rerun, paying the noisy cost
// again. Runner's fallback policy reruns the command for non-fork tools.

import type { CompetitorWorkflow } from "./types.js";

const NOISY = `
const codes = ["INFO", "WARN", "ERROR", "DEBUG", "TRACE"];
for (let i = 0; i < 400; i++) {
  const c = codes[i % codes.length];
  console.log("[" + c + "] event " + i + " thing-" + (i % 17) + " token-rare-" + (i % 53));
}
console.log("SUMMARY: 400 events, marker-found-once-only");
`.replace(/\n/g, " ");

const wf: CompetitorWorkflow = {
  name: "sidecar-replay",
  description: "Run noisy command, then query result without rerun. Fork sidecars; others rerun.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "command",
      label: "noisy-exec",
      command: `node -e ${JSON.stringify(NOISY)}`,
      timeoutMs: 15_000,
      assert: (t) => /SUMMARY|marker|event/i.test(t) || t.length > 100,
    },
    {
      kind: "search",
      label: "find-summary",
      query: "marker-found-once-only",
      assert: (t) => t.length > 0,
    },
    {
      kind: "search",
      label: "find-rare-token",
      query: "token-rare-51 event",
      assert: (t) => t.length > 0,
    },
  ],
};

export default wf;
