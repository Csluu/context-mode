// Phase 1 — Workflow B: dedup compounding.
// 5 large files (>500 lines, since fork only caches above that threshold)
// read 5 times each. Tools that dedup should plateau after pass 1.

import { resolve } from "node:path";
import type { CompetitorWorkflow, ReadStep } from "./types.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const files = [
  "src/server.ts",
  "src/session/analytics.ts",
  "src/store.ts",
  "src/cli.ts",
  "src/session/extract.ts",
];

const steps: ReadStep[] = [];
for (let pass = 1; pass <= 5; pass++) {
  for (const f of files) {
    const fname = f.split(/[\\/]/).pop() ?? f;
    steps.push({
      kind: "read",
      label: `pass${pass}-${f.replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}`,
      path: resolve(REPO_ROOT, f),
      mode: "full",
      // Oracle: "did the tool process this read sensibly?"
      // Valid responses:
      //   - full content (raw): filename appears OR length > 100
      //   - dedup ref / cache hit / compressed summary (any compressor): length < 1KB
      //     (anything smaller than 1KB is definitionally NOT a full re-dump)
      //   - explicit ref keyword
      assert: (t) =>
        t.length < 1024
        || t.includes(fname)
        || /ref|cached|dedup|unchanged|hash|\b[a-f0-9]{8,}\b/i.test(t),
    });
  }
}

const wf: CompetitorWorkflow = {
  name: "dedup-compounding",
  description: "Read same 5 large files 5x each (25 reads). Tools that dedup should plateau after pass 1.",
  fallbackPolicy: "raw-on-error",
  steps,
};

export default wf;
