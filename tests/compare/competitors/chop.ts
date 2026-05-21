// chop adapter.
// CLI: `chop "<cmd>"` directly per docs ("chop docker ps"). Hook-based primary.
// First-class CLI: `chop init`/`chop wrap`. We use `chop wrap <cmd>` then fall
// back to direct invocation form.

import {
  type CompetitorAdapter,
  type CompetitorRunResult,
  type ReadFileOpts,
  type RunCommandOpts,
  estimateInstallSize,
  spawnCapture,
  spawnToRunResult,
  which,
} from "./lib.js";

const BIN = "chop";
let _resolvedBin: string | null = null;
function resolveBin(): string {
  if (_resolvedBin) return _resolvedBin;
  _resolvedBin = which(BIN) ?? BIN;
  return _resolvedBin;
}

// Lightweight argv splitter — handles double-quoted and single-quoted segments.
// Used so `chop` sees the underlying tool as its first arg (lets chop's
// pattern matchers — git/npm/docker — fire correctly).
function simpleArgSplit(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (!inDouble && !inSingle && /\s/.test(ch)) {
      if (cur.length > 0) { out.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export const chopAdapter: CompetitorAdapter = {
  id: "chop",
  description: "chop — CLI output compressor for Claude / Gemini / Codex / Antigravity.",
  async detect() {
    const bin = which(BIN);
    if (!bin) return { available: false, reason: `${BIN} not on PATH. Install: powershell -c \"irm https://raw.githubusercontent.com/AgusRdz/chop/main/install.ps1 | iex\"` };
    const r = spawnCapture(bin, ["--version"], { timeoutMs: 5000 });
    const version = (r.stdoutText + r.stderrText).split(/\r?\n/)[0]?.trim() || "unknown";
    return { available: true, version, installSizeBytes: estimateInstallSize(BIN) };
  },
  async runCommand(cmd: string, opts: RunCommandOpts = {}): Promise<CompetitorRunResult> {
    // chop CLI shape: `chop <command> [args...]` — chop spawns the underlying
    // process directly and applies its command-specific pattern (git, npm, etc).
    //
    // Branching: if cmd contains shell metacharacters (pipes, $-expansion,
    // semicolons, redirects, &&, ||), bash needs to interpret it. Use
    // `chop bash -c "<cmd>"` for those; direct invocation otherwise so chop's
    // command-specific pattern fires.
    const needsBashShell = /[|;&$<>(){}`]|&&|\|\|/.test(cmd);
    let args: string[];
    if (needsBashShell) {
      args = ["bash", "-c", cmd];
    } else {
      // Split on whitespace; preserves quoted args via a simple lexer.
      args = simpleArgSplit(cmd);
    }
    const spawn = spawnCapture(resolveBin(), args, opts);
    return spawnToRunResult("chop", cmd.slice(0, 40), spawn, opts.keepOutput);
  },
  async readFile(path: string, opts: ReadFileOpts = {}): Promise<CompetitorRunResult> {
    const cmd = process.platform === "win32" ? `type "${path}"` : `cat "${path}"`;
    return this.runCommand!(cmd, { keepOutput: opts.keepOutput });
  },
};
