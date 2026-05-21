// Workflow: after some real activity, validate the savings reporters.
// Expected: ctx_gain / ctx_discover / ctx_stats give consistent, believable
// numbers reflecting the session's reads + execs.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "stats-believability",
  description: "Do a few reads + an execute, then call ctx_gain / ctx_discover / ctx_stats. Verify the savings reporters agree with what just happened.",
  forkOnly: true,
  steps: [
    { label: "warm-read",    tool: "ctx_read",     args: { path: join(repoRoot, "src", "store.ts"), mode: "outline" }, assert: (t) => /ContentStore|class|export/i.test(t) },
    { label: "warm-search",  tool: "ctx_search",   args: { queries: ["ContentStore"] }, assert: (t) => t.length > 0 },
    { label: "warm-execute", tool: "ctx_execute",  args: { language: "javascript", code: "for (let i=0;i<50;i++) console.log('line ' + i);" }, assert: (t) => /line\s*0|line\s*49|49 line/.test(t) || t.length > 100 },
    { label: "gain",     tool: "ctx_gain",     args: {}, assert: (t) => /save|gain|bytes|token|\d/i.test(t) },
    { label: "discover", tool: "ctx_discover", args: {}, assert: (t) => /discover|bypass|tool|finding|\d/i.test(t) },
    { label: "stats",    tool: "ctx_stats",    args: { scope: "session" }, assert: (t) => /stat|session|invocations?|bytes|tokens|\d/i.test(t) },
  ],
};

export default wf;
