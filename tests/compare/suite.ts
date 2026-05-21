// Shared Suite shape for tool comparison harnesses. Each module under
// tests/compare/tools/*.ts default-exports a Suite. The generic runner
// (tests/compare/run.ts) and orchestrator (tests/compare/run-all.ts)
// consume these.

import type { Scenario } from "./lib.js";

export interface Suite {
  name: string;
  scenarios: Scenario[];
  /** Extra env vars merged into the isolated CONTEXT_MODE_HOME env. */
  env?: Record<string, string>;
  /** Optional async setup that may mutate `this.scenarios` (e.g. start a fixture server). */
  beforeAll?(): Promise<void>;
  /** Optional async teardown. */
  afterAll?(): Promise<void>;
  /** If true, only the fork client runs. Use for Dim 4 fork-only features.
   *  upstream column in the report is marked `n/a`. */
  forkOnly?: boolean;
  /** If true, spawn fresh client(s) per scenario. Required when the tool
   *  has cross-call state that would skew multi-iteration measurements:
   *   - ctx_read deduplicates repeated reads within a session (iter 2+
   *     returns a shortened "already shown" notice).
   *   - ctx_search rate-limits to 8 calls / 60s window per session.
   *  Cost: extra spawn/initialize per scenario (~100-300ms each). */
  freshClientPerScenario?: boolean;
}
