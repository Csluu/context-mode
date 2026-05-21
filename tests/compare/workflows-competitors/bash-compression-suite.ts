// Phase 1 — Workflow A: bash compression head-to-head.
// 10 noisy commands typical of agentic sessions.

import type { CompetitorWorkflow } from "./types.js";

const wf: CompetitorWorkflow = {
  name: "bash-compression-suite",
  description: "10 noisy real-world dev commands. Each tool wraps each command; output bytes measured.",
  fallbackPolicy: "raw-on-error",
  steps: [
    { kind: "command", label: "git-log-100", command: "git log --oneline -100", timeoutMs: 15_000, assert: (t) => t.length > 30 },
    { kind: "command", label: "git-status-porcelain", command: "git status --porcelain=v1 -uall", timeoutMs: 10_000, assert: (t) => t.length >= 0 },
    { kind: "command", label: "find-files", command: "find . -maxdepth 5 -type f -name '*.ts' | head -200", timeoutMs: 20_000, assert: (t) => t.includes(".ts") || t.length < 200 },
    { kind: "command", label: "ls-recursive", command: "ls -laR src/tools src/diff src/read 2>/dev/null", timeoutMs: 10_000, assert: (t) => t.length > 30 },
    {
      kind: "command", label: "noisy-loop",
      command: "for i in $(seq 1 200); do echo \"[trace] iteration $i alpha bravo charlie token-$i\"; done; echo \"ERROR final marker\"",
      timeoutMs: 10_000, assert: (t) => /ERROR|trace|iteration/i.test(t),
    },
    { kind: "command", label: "git-log-large", command: "git log --pretty=fuller -n 30", timeoutMs: 15_000, assert: (t) => t.length > 100 },
    { kind: "command", label: "git-diff-head", command: "git diff HEAD~3 HEAD", timeoutMs: 15_000, assert: (t) => t.length >= 0 },
    { kind: "command", label: "node-version-loop", command: "for i in $(seq 1 10); do echo \"build #$i $(date +%s)\"; node --version; npm --version; done", timeoutMs: 30_000, assert: (t) => /v\d/.test(t) },
    { kind: "command", label: "cat-package-json", command: "cat package.json", timeoutMs: 5_000, assert: (t) => t.includes("\"name\"") },
    { kind: "command", label: "tree-build-dir", command: "ls -la build | head -100", timeoutMs: 5_000, assert: (t) => t.length > 30 },
  ],
};

export default wf;
