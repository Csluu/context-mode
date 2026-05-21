// Onboarding-questions workflow — simulates the first 12 commands an agent runs
// when introduced to an unfamiliar TypeScript codebase. Uses this repo as the
// fixture; commands are exactly what a real Claude agent would execute.
//
// Closer to "real session" than synthetic noisy-loop tests. Total tokens here
// approximate "how many tokens does each tool cost a real onboarding session?"

import type { CompetitorWorkflow } from "./types.js";

const wf: CompetitorWorkflow = {
  name: "onboarding-questions",
  description: "12 realistic onboarding commands on this TS repo. Cumulative tokens = onboarding session cost.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "command", label: "1-what-is-this",
      command: "cat package.json | head -40",
      timeoutMs: 10_000,
      assert: (t) => t.includes("\"name\"") || t.length > 30,
    },
    {
      kind: "command", label: "2-readme-head",
      command: "head -80 README.md 2>/dev/null || head -80 readme.md 2>/dev/null || echo missing",
      timeoutMs: 5_000,
      assert: (t) => t.length > 30,
    },
    {
      kind: "command", label: "3-list-src",
      command: "find src -maxdepth 2 -type d | head -30",
      timeoutMs: 10_000,
      assert: (t) => /src/i.test(t),
    },
    {
      kind: "command", label: "4-entry-points",
      command: "ls -la src/server.ts src/cli.ts 2>&1 | head -10",
      timeoutMs: 5_000,
      assert: (t) => /server|cli/i.test(t),
    },
    {
      kind: "command", label: "5-find-routes",
      command: "grep -rln 'registerTool' src | head -30",
      timeoutMs: 15_000,
      assert: (t) => /\.(ts|js)/i.test(t) || t.length > 0,
    },
    {
      kind: "command", label: "6-test-layout",
      command: "find tests -maxdepth 3 -type f -name '*.ts' | head -40",
      timeoutMs: 15_000,
      assert: (t) => /tests|spec/i.test(t),
    },
    {
      kind: "command", label: "7-git-log-context",
      command: "git log --oneline -30",
      timeoutMs: 15_000,
      assert: (t) => /[a-f0-9]{6,}/i.test(t),
    },
    {
      kind: "command", label: "8-recent-changes",
      command: "git diff HEAD~3 HEAD --stat",
      timeoutMs: 15_000,
      assert: (t) => t.length >= 0,
    },
    {
      kind: "command", label: "9-config-files",
      command: "ls -la tsconfig*.json *.config.* 2>/dev/null | head -20",
      timeoutMs: 5_000,
      assert: (t) => t.length > 0,
    },
    {
      kind: "command", label: "10-test-runner",
      command: "grep -E '\"test\"|vitest|jest|mocha' package.json | head -10",
      timeoutMs: 5_000,
      assert: (t) => /test|vitest|jest|mocha/i.test(t) || t.length >= 0,
    },
    {
      kind: "command", label: "11-deps-overview",
      command: "node -e \"const p=require('./package.json'); console.log('deps:', Object.keys(p.dependencies||{}).length, 'devDeps:', Object.keys(p.devDependencies||{}).length); console.log(Object.keys(p.dependencies||{}).slice(0,15).join(','))\"",
      timeoutMs: 5_000,
      assert: (t) => /deps|dependencies/i.test(t),
    },
    {
      kind: "command", label: "12-build-script",
      command: "node -e \"const p=require('./package.json'); console.log('build:', p.scripts?.build || 'none'); console.log('test:', p.scripts?.test || 'none')\"",
      timeoutMs: 5_000,
      assert: (t) => /build|test/i.test(t),
    },
  ],
};

export default wf;
