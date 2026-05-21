// Tier 1: sidecar usefulness. After ctx_execute with intent, the raw output
// is stored as a sidecar. Subsequent ctx_search / ctx_fetch_run should answer
// follow-up questions WITHOUT a rerun. Oracle: search returns expected token
// from the original noisy output without paying the noisy cost again.

import type { Workflow } from "./index.js";

const noisy = `
const codes = ["INFO", "WARN", "ERROR", "DEBUG", "TRACE"];
for (let i = 0; i < 400; i++) {
  const c = codes[i % codes.length];
  console.log("[" + c + "] event " + i + " thing-" + (i % 17) + " token-rare-" + (i % 53));
}
console.log("SUMMARY: 400 events, marker-found-once-only");
`;

const wf: Workflow = {
  name: "sidecar-followup",
  description: "Run a noisy ctx_execute with intent → ctx_search the indexed result → ctx_fetch_run for raw. Validates follow-ups without rerun.",
  forkOnly: true,
  steps: [
    {
      label: "run-noisy",
      tool: "ctx_execute",
      args: { language: "javascript", code: noisy, intent: "SUMMARY marker rare events" },
      assert: (text) => text.includes("SUMMARY") || text.includes("indexed") || text.includes("section"),
    },
    {
      label: "search-summary",
      tool: "ctx_search",
      args: { queries: ["SUMMARY marker-found-once-only"] },
      assert: (text) => text.includes("SUMMARY") || text.includes("marker-found-once-only"),
    },
    {
      label: "fetch-raw",
      tool: "ctx_fetch_run",
      args: { latest: true, raw: true },
      assert: (text) => text.includes("event 0") || text.includes("[INFO]") || text.length > 1000,
    },
  ],
};

export default wf;
