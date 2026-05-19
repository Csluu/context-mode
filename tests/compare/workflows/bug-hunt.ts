// Workflow: typical bug investigation.
//   route(noisy command) → batch_execute(git context) → search(error term)
//   → read(implicated file outline) → execute(reproduce)
// Mirrors a session where Claude triages a failing change against main.

import { join } from "node:path";
import { repoRoot } from "../lib.js";
import type { Workflow } from "./index.js";

const wf: Workflow = {
  name: "bug-hunt",
  description: "Investigate a failing change: classify command, gather git context, search prior errors, read implicated source, attempt repro.",
  steps: [
    {
      label: "route-git-diff",
      tool: "ctx_route",
      args: { command: "git diff main", explain: true },
    },
    {
      label: "batch-git-context",
      tool: "ctx_batch_execute",
      args: {
        commands: [
          { label: "git-status", command: "git status --porcelain" },
          { label: "git-log",    command: "git log --oneline -20" },
          { label: "git-diff",   command: "git diff main --stat" },
        ],
        queries: ["modified files", "recent commits"],
      },
    },
    {
      label: "search-errors",
      tool: "ctx_search",
      args: { queries: ["error", "modified", "recent"] },
    },
    {
      label: "read-server-outline",
      tool: "ctx_read",
      args: { path: join(repoRoot, "src", "server.ts"), mode: "outline" },
    },
    {
      label: "execute-version-check",
      tool: "ctx_execute",
      args: { language: "shell", code: "node --version && npm --version" },
    },
  ],
};

export default wf;
