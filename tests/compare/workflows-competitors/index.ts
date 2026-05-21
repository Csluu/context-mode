// Phase 1 + 1.5 workflow registry.

import bash from "./bash-compression-suite.js";
import dedup from "./dedup-compounding.js";
import cascade from "./cascade-50turn.js";
import cascade500 from "./cascade-500turn.js";
import webFetch from "./web-fetch-suite.js";
import massiveDiff from "./massive-diff.js";
import searchCorpus from "./search-corpus.js";
import sidecarReplay from "./sidecar-replay.js";
import longOutput from "./long-output-stress.js";
import binary from "./binary-handling.js";
import ansi from "./ansi-stripping.js";
import unicode from "./unicode-emoji-heavy.js";
import stderr from "./stderr-heavy.js";
import restartCache from "./restart-cache-test.js";
import langCoverage from "./lang-coverage.js";
import onboarding from "./onboarding-questions.js";
import realCiLog from "./real-ci-log.js";

import type { CompetitorWorkflow } from "./types.js";

// Removed from registry (kept files for ad-hoc runs):
//   - failing-build:     raw output 184B; too small to test compression honestly
//   - real-npm-install:  raw output ~1.8KB; network jitter dominates
//   - real-cargo-check:  raw output ~575B; both small + slow + cargo-may-be-missing
// These ran 0% saved across most tools because there's nothing to compress.

// Default fast suite — 16 workflows, runs in ~5-8 min with N=3.
// Set COMPETITOR_INCLUDE_LONG=1 to add cascade-500turn (adds ~20 min).
const includeLong = process.env.COMPETITOR_INCLUDE_LONG === "1";
export const PHASE1_WORKFLOWS: readonly CompetitorWorkflow[] = [
  bash, dedup, cascade,
  webFetch, massiveDiff, searchCorpus, sidecarReplay,
  longOutput, binary, ansi, unicode, stderr,
  restartCache,
  langCoverage, onboarding, realCiLog,
  ...(includeLong ? [cascade500] : []),
];

// Workflows where only fork has the capability — listed for the report so we
// can flag them with a "fork-only territory" tag rather than fake savings.
export const FORK_ONLY_WORKFLOWS = new Set<string>([
  "web-fetch-suite",
  "search-corpus",
  "sidecar-replay",
  "restart-cache-test",
]);
