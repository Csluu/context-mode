// squeez adapter.
// CLI: `squeez wrap <cmd>` — compresses end-to-end. `squeez filter <hint>` for stdin.
// Hook-based primary but the wrap subcommand is documented for manual invocation.

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

const BIN = "squeez";
let _resolvedBin: string | null = null;
function resolveBin(): string {
  if (_resolvedBin) return _resolvedBin;
  _resolvedBin = which(BIN) ?? BIN;
  return _resolvedBin;
}

export const squeezAdapter: CompetitorAdapter = {
  id: "squeez",
  description: "squeez wrap — hook-based bash compressor (95% claim).",
  async detect() {
    const bin = which(BIN);
    if (!bin) return { available: false, reason: `${BIN} not on PATH. Install: npm i -g squeez` };
    const r = spawnCapture(bin, ["--version"], { timeoutMs: 5000 });
    const version = (r.stdoutText + r.stderrText).split(/\r?\n/)[0]?.trim() || "unknown";
    return { available: true, version, installSizeBytes: estimateInstallSize(BIN) };
  },
  async calibrate() {
    // `squeez calibrate` auto-tunes config. Safe to invoke.
    const r = spawnCapture(resolveBin(), ["calibrate"], { timeoutMs: 30_000 });
    return { ok: r.exitCode === 0, reason: r.exitCode === 0 ? "calibrate OK" : `exit=${r.exitCode}` };
  },
  async runCommand(cmd: string, opts: RunCommandOpts = {}): Promise<CompetitorRunResult> {
    // squeez wrap accepts the command as one positional. Quote inside-out is
    // handled by spawnCapture not invoking a shell — args are passed directly.
    const spawn = spawnCapture(resolveBin(), ["wrap", cmd], opts);
    return spawnToRunResult("squeez", cmd.slice(0, 40), spawn, opts.keepOutput);
  },
  async readFile(path: string, opts: ReadFileOpts = {}): Promise<CompetitorRunResult> {
    const cmd = process.platform === "win32" ? `type "${path}"` : `cat "${path}"`;
    return this.runCommand!(cmd, { keepOutput: opts.keepOutput });
  },
};
