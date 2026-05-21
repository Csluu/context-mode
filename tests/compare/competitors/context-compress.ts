// context-compress adapters — balanced (default) + aggressive mode variants.
// CLI: `context-compress wrap "<cmd>"`. Mode controlled by CONTEXT_COMPRESS_MODE env.

import {
  type CompetitorAdapter,
  type CompetitorId,
  type ReadFileOpts,
  type RunCommandOpts,
  spawnCapture,
  spawnToRunResult,
  which,
} from "./lib.js";

const BIN = "context-compress";
let _resolvedBin: string | null = null;
function resolveBin(): string {
  if (_resolvedBin) return _resolvedBin;
  _resolvedBin = which(BIN) ?? BIN;
  return _resolvedBin;
}

function makeAdapter(mode: string, id: CompetitorId, descSuffix: string): CompetitorAdapter {
  return {
    id,
    description: `context-compress wrap — ${descSuffix} mode.`,
    async detect() {
      const bin = which(BIN);
      if (!bin) return { available: false, reason: `${BIN} not on PATH. Install: npm i -g context-compress` };
      const r = spawnCapture(bin, ["--version"], { timeoutMs: 5000 });
      const version = (r.stdoutText + r.stderrText).split(/\r?\n/)[0]?.trim() || "unknown";
      return { available: true, version: `${version} (mode=${mode})` };
    },
    async calibrate() {
      // context-compress has `setup --auto`; we don't write to user's claude config
      // here — calibration in the harness is a no-op for safety.
      return { ok: true, reason: "skipped (would modify Claude Code config)" };
    },
    async runCommand(cmd, opts: RunCommandOpts = {}) {
      const env = { ...process.env, ...(opts.env || {}), CONTEXT_COMPRESS_MODE: mode };
      const spawn = spawnCapture(resolveBin(), ["wrap", cmd], { ...opts, env });
      return spawnToRunResult(id, cmd.slice(0, 40), spawn, opts.keepOutput);
    },
    async readFile(path: string, opts: ReadFileOpts = {}) {
      const cmd = process.platform === "win32" ? `type "${path}"` : `cat "${path}"`;
      return this.runCommand!(cmd, { keepOutput: opts.keepOutput });
    },
  };
}

export const contextCompressAdapter: CompetitorAdapter = makeAdapter("balanced", "context-compress", "balanced");
export const contextCompressAggressiveAdapter: CompetitorAdapter = makeAdapter("aggressive", "context-compress-aggressive", "aggressive");
