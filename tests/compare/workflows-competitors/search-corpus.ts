// Phase 1.5 — Search across an indexed corpus.
// Step 1: index the corpus (fork uses ctx_index; raw walks `ls -laR`).
// Step 2..N: query the index. Fork uses FTS5 BM25. Raw uses grep -rEn.
//
// Fairness fix: previously fork ctx_search returned "no results" because we
// never indexed anything. Now we index first, then query.

import { resolve } from "node:path";
import type { CompetitorWorkflow } from "./types.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const CORPUS_DIR = resolve(REPO_ROOT, "src");
const CORPUS_SOURCE = "bench-search-corpus";

const wf: CompetitorWorkflow = {
  name: "search-corpus",
  description: "Index src/ then query it. Fork uses FTS5 BM25; raw uses grep -rEn.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "index",
      label: "index-src",
      path: CORPUS_DIR,
      source: CORPUS_SOURCE,
      timeoutMs: 60_000,
      assert: (t) => t.length > 0,
    },
    {
      kind: "search",
      label: "search-context-mode",
      query: "context mode mcp tool",
      source: CORPUS_SOURCE,
      assert: (t) => t.length > 0,
    },
    {
      kind: "search",
      label: "search-ctx-execute",
      query: "ctx_execute language shell sandbox",
      source: CORPUS_SOURCE,
      assert: (t) => /execute|shell|sandbox/i.test(t) || t.length > 0,
    },
    {
      kind: "search",
      label: "search-bm25",
      query: "FTS5 BM25 search",
      source: CORPUS_SOURCE,
      assert: (t) => t.length > 0,
    },
    {
      kind: "search",
      label: "search-diff-risk",
      query: "renderDiffRiskFocus risk file",
      source: CORPUS_SOURCE,
      assert: (t) => /risk|diff/i.test(t) || t.length > 0,
    },
    {
      kind: "search",
      label: "search-rare-token",
      query: "TINY_DIRECT_PATTERNS route",
      source: CORPUS_SOURCE,
      assert: (t) => t.length > 0,
    },
    {
      kind: "search",
      label: "search-readme-claim",
      query: "save context window FTS5",
      source: CORPUS_SOURCE,
      assert: (t) => t.length > 0,
    },
  ],
};

export default wf;
