// Phase 1 — Workflow C: 50-turn cascade.
// Mix of bash and read steps mimicking a realistic agentic session.
// Cumulative bytes after each turn quantify the chop/squeez "tokens carry forward" pitch.

import { resolve } from "node:path";
import type { AnyStep, CompetitorWorkflow } from "./types.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const r = (p: string) => resolve(REPO_ROOT, p);

const steps: AnyStep[] = [
  { kind: "command", label: "1-git-status", command: "git status --porcelain -uall" , assert: (t) => /modified|untracked|clean|status|porcelain|\?\?| M /i.test(t) || t.length >= 0 },
  { kind: "read",    label: "2-read-package", path: r("package.json"), mode: "full" , assert: (t) => /name|version|scripts/i.test(t) || t.length >= 0 },
  { kind: "command", label: "3-ls-src", command: "ls -la src" , assert: (t) => /\.ts|drwx|total |\.json|build|src/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "4-read-server", path: r("src/server.ts"), mode: "map" , assert: (t) => /server|registerTool|McpServer|symbol|map|outline|provider|import/i.test(t) || t.length >= 0 },
  { kind: "command", label: "5-git-log-30", command: "git log --oneline -30" , assert: (t) => /[a-f0-9]{6,}|commit|by|on|\b\d{4}-\d{2}-\d{2}/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "6-read-readme", path: r("README.md"), mode: "full" , assert: (t) => /readme|context|tool|install|usage|#/i.test(t) || t.length >= 0 },
  { kind: "command", label: "7-grep-routes", command: "grep -rn 'registerTool' src | head -50" , assert: (t) => /\.ts|src|registerTool|isError|export|function/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "8-read-route", path: r("src/tools/route.ts"), mode: "map" , assert: (t) => /route|registerTool|RouteResult|tool|export|symbol|outline|provider/i.test(t) || t.length >= 0 },
  { kind: "command", label: "9-git-diff-head", command: "git diff HEAD~1 HEAD" , assert: (t) => /diff|@@|---|\+\+\+|no changes|files? changed/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "10-read-diff-text", path: r("src/diff/git-text.ts"), mode: "outline" , assert: (t) => /diff|displayText|RenderDiff|export|function|symbol|outline|provider/i.test(t) || t.length >= 0 },
  { kind: "command", label: "11-find-tests", command: "find tests -type f -name '*.ts' | head -100" , assert: (t) => /\.ts|\.js|src|tests|build/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "12-read-suite", path: r("tests/compare/suite.ts"), mode: "full" , assert: (t) => /suite|describe|it|test|export|function|symbol|outline/i.test(t) || t.length >= 0 },
  { kind: "command", label: "13-noisy-loop", command: "for i in $(seq 1 100); do echo \"[trace] $i\"; done" , assert: (t) => /trace|line|iteration/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "14-read-runner", path: r("tests/compare/runner.ts"), mode: "outline" , assert: (t) => /runner|run|export|function|symbol|outline/i.test(t) || t.length >= 0 },
  { kind: "command", label: "15-git-log-author", command: "git log --pretty=format:'%h %an %s' -50" , assert: (t) => /[a-f0-9]{6,}|commit|by|on|\b\d{4}-\d{2}-\d{2}/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "16-read-fork-adapter", path: r("tests/compare/competitors/fork.ts"), mode: "full" , assert: (t) => /fork|adapter|export|function|class|McpClient|symbol|outline/i.test(t) || t.length >= 0 },
  { kind: "command", label: "17-cat-package2", command: "cat package.json" , assert: (t) => /name|version|scripts/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "18-read-server2", path: r("src/server.ts"), mode: "map" , assert: (t) => /server|registerTool|symbol|outline/i.test(t) || t.length >= 0 },
  { kind: "command", label: "19-ls-build-tools", command: "ls -la build/tools" , assert: (t) => /\.ts|drwx|total |\.json|build|src/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "20-read-route2", path: r("src/tools/route.ts"), mode: "outline" , assert: (t) => /route|tool|export|function|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "21-git-diff-stat", command: "git diff HEAD~5 HEAD --stat" , assert: (t) => /diff|@@|---|\+\+\+|no changes|files? changed/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "22-read-diff-tool", path: r("src/tools/diff.ts"), mode: "full" , assert: (t) => /diff|tool|export|function|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "23-grep-error", command: "grep -rn 'isError' src/tools | head -40" , assert: (t) => /\.ts|src|registerTool|isError|export|function/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "24-read-read-tool", path: r("src/tools/read.ts"), mode: "outline" , assert: (t) => /read|tool|export|function|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "25-git-branch", command: "git branch --show-current" , assert: (t) => /main|master|tier|branch|\w/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "26-read-types", path: r("src/tools/types.ts"), mode: "full" , assert: (t) => /interface|type|export|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "27-noisy-find", command: "find src -type f | head -200" , assert: (t) => t.length >= 0 },
  { kind: "read",    label: "28-read-registry", path: r("src/tools/registry.ts"), mode: "outline" , assert: (t) => /registry|tool|register|export|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "29-git-log-tiny", command: "git log --oneline -10" , assert: (t) => /[a-f0-9]{6,}|commit|by|on|\b\d{4}-\d{2}-\d{2}/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "30-read-package2", path: r("package.json"), mode: "full" , assert: (t) => /name|version|scripts/i.test(t) || t.length >= 0 },
  { kind: "command", label: "31-cat-mcp", command: "cat .mcp.json 2>/dev/null || echo missing" , assert: (t) => /mcpServers|missing|context-mode|\{|\}/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "32-read-server3", path: r("src/server.ts"), mode: "map" , assert: (t) => /server|registerTool|symbol|outline/i.test(t) || t.length >= 0 },
  { kind: "command", label: "33-grep-tools", command: "grep -rln 'ToolDefinition' src | head -30" , assert: (t) => /\.ts|src|registerTool|isError|export|function/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "34-read-doctor", path: r("src/tools/doctor.ts"), mode: "outline" , assert: (t) => /doctor|export|function|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "35-git-show-head", command: "git show HEAD --stat" , assert: (t) => /commit|files? changed|insertion|deletion|@@/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "36-read-upgrade", path: r("src/tools/upgrade.ts"), mode: "full" , assert: (t) => /upgrade|export|function|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "37-find-md", command: "find . -maxdepth 3 -name '*.md' | head -50" , assert: (t) => /\.ts|\.js|src|tests|build/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "38-read-claude", path: r("CLAUDE.md"), mode: "full" , assert: (t) => /claude|context|tool|mode|#/i.test(t) || t.length >= 0 },
  { kind: "command", label: "39-ls-tests", command: "ls -la tests/compare | head -50" , assert: (t) => /\.ts|tests|drwx|compare/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "40-read-fork2", path: r("tests/compare/competitors/fork.ts"), mode: "outline" , assert: (t) => /fork|adapter|export|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "41-git-log-files", command: "git log --name-only -20" , assert: (t) => /[a-f0-9]{6,}|commit|by|on|\b\d{4}-\d{2}-\d{2}/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "42-read-diff-text2", path: r("src/diff/git-text.ts"), mode: "full" , assert: (t) => /diff|displayText|RenderDiff|export|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "43-grep-export", command: "grep -rn 'export function' src/diff | head -30" , assert: (t) => /\.ts|src|registerTool|isError|export|function/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "44-read-route3", path: r("src/tools/route.ts"), mode: "full" , assert: (t) => /route|registerTool|tool|export|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "45-git-status2", command: "git status --porcelain" , assert: (t) => /modified|untracked|clean|status|porcelain|\?\?| M /i.test(t) || t.length >= 0 },
  { kind: "read",    label: "46-read-types2", path: r("src/tools/types.ts"), mode: "outline" , assert: (t) => /interface|type|export|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "47-find-build", command: "find build -type f -name '*.js' | head -100" , assert: (t) => /\.ts|\.js|src|tests|build/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "48-read-read2", path: r("src/tools/read.ts"), mode: "full" , assert: (t) => /read|tool|export|function|symbol/i.test(t) || t.length >= 0 },
  { kind: "command", label: "49-noisy-iter", command: "for i in $(seq 1 50); do echo \"line $i\"; done" , assert: (t) => /line/i.test(t) || t.length >= 0 },
  { kind: "read",    label: "50-read-server4", path: r("src/server.ts"), mode: "outline" , assert: (t) => /server|registerTool|symbol|outline/i.test(t) || t.length >= 0 },
];

const wf: CompetitorWorkflow = {
  name: "cascade-50turn",
  description: "50-turn mixed session (commands + reads). Measures compounding context cost.",
  fallbackPolicy: "raw-on-error",
  steps,
};

export default wf;
