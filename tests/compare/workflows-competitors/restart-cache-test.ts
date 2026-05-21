// Phase 1.5 — Cache persistence across restart.
// Fork's read cache is in-memory; surviving a process restart is a real-world
// concern (e.g. user restarts editor, MCP re-spawns). This workflow surfaces
// the gap honestly. Marker step uses `onlyForTools: ["fork"]` so the report
// can show fork-specific data only — other tools have no equivalent.

import { resolve } from "node:path";
import type { CompetitorWorkflow } from "./types.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const TARGET = resolve(REPO_ROOT, "src/server.ts");

const wf: CompetitorWorkflow = {
  name: "restart-cache-test",
  description: "Read big file → simulate restart marker → read again. Surfaces in-memory cache fragility.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "read",
      label: "warm-read-1",
      path: TARGET,
      mode: "full",
      assert: (t) => t.length > 100,
    },
    {
      kind: "read",
      label: "warm-read-2",
      path: TARGET,
      mode: "full",
      assert: (t) => t.length > 50,
    },
    // Restart simulation marker — runner does NOT automatically restart MCP.
    // The bytes-after-marker step measures whatever cache state remained.
    // Real persistence-across-restart needs a separate harness run with an
    // explicit MCP kill between this step and the next.
    {
      kind: "command",
      label: "restart-marker",
      command: "echo 'RESTART-SIMULATION-MARKER'",
      timeoutMs: 2_000,
      assert: (t) => /RESTART/.test(t),
    },
    {
      kind: "read",
      label: "post-restart-read",
      path: TARGET,
      mode: "full",
      assert: (t) => t.length > 50,
    },
  ],
};

export default wf;
