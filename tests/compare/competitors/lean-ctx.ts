// LeanCTX adapters — default + aggressive variants.
// CLI: `lean-ctx -c "<cmd>"` for shell wrap, `lean-ctx read <path> -m <mode>` for reads.
// Aggressive variant adds `--aggressive` flag (if supported by installed version).

import {
  type CompetitorAdapter,
  type CompetitorId,
  type ReadFileOpts,
  type RunCommandOpts,
  estimateInstallSize,
  spawnCapture,
  spawnToRunResult,
  which,
} from "./lib.js";

const BIN = "lean-ctx";
let _resolvedBin: string | null = null;
function resolveBin(): string {
  if (_resolvedBin) return _resolvedBin;
  _resolvedBin = which(BIN) ?? BIN;
  return _resolvedBin;
}

function makeAdapter(extraArgs: readonly string[], id: CompetitorId, descSuffix: string): CompetitorAdapter {
  return {
    id,
    description: `LeanCTX ${descSuffix} — 10 read modes, 56 shell pattern modules, tree-sitter for 21 langs.`,
    async detect() {
      const bin = which(BIN);
      if (!bin) return { available: false, reason: `${BIN} not on PATH. Install: cargo install lean-ctx` };
      const r = spawnCapture(bin, ["--version"], { timeoutMs: 5000 });
      const version = (r.stdoutText + r.stderrText).split(/\r?\n/)[0]?.trim() || "unknown";
      return {
        available: true,
        version: `${version}${extraArgs.length > 0 ? " " + extraArgs.join(" ") : ""}`,
        installSizeBytes: estimateInstallSize(BIN),
      };
    },
    async calibrate() {
      // lean-ctx has `lean-ctx benchmark report .` — not a calibration but
      // probes the install. Skipped here to avoid blowing the benchmark budget.
      return { ok: true, reason: "skipped (lean-ctx has no per-host calibration)" };
    },
    async runCommand(cmd: string, opts: RunCommandOpts = {}) {
      const spawn = spawnCapture(resolveBin(), [...extraArgs, "-c", cmd], opts);
      return spawnToRunResult(id, cmd.slice(0, 40), spawn, opts.keepOutput);
    },
    async readFile(path: string, opts: ReadFileOpts = {}) {
      let mode = "full";
      if (opts.mode === "map") mode = "map";
      else if (opts.mode === "outline") mode = "signatures";
      else if (opts.mode === "slice" && opts.start && opts.end) mode = `lines:${opts.start}-${opts.end}`;
      else if (opts.mode === "full") mode = "full";
      const args = [...extraArgs, "read", path, "-m", mode];
      const spawn = spawnCapture(resolveBin(), args, { timeoutMs: 30_000 });
      return spawnToRunResult(id, `read:${path}`, spawn, opts.keepOutput);
    },
  };
}

export const leanCtxAdapter: CompetitorAdapter = makeAdapter([], "lean-ctx", "default");
export const leanCtxAggressiveAdapter: CompetitorAdapter = makeAdapter(["--aggressive"], "lean-ctx-aggressive", "aggressive (--aggressive flag)");
