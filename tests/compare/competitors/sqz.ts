// sqz adapter.
// CLI: `sqz` binary from sqz-cli crate. Hook-based primary; manual wrap pattern
// is `sqz wrap <cmd>` mirroring squeez. We try wrap first, then fall back to
// piping the raw output through `sqz filter` if the binary errors on `wrap`.

import {
  type CompetitorAdapter,
  type CompetitorRunResult,
  type ReadFileOpts,
  type RunCommandOpts,
  estimateInstallSize,
  spawnCapture,
  spawnToRunResult,
  which,
  runViaBash,
} from "./lib.js";

const BIN = "sqz";
const VIA_WSL = process.env.SQZ_VIA_WSL === "1";
const WSL_DISTRO = process.env.SQZ_WSL_DISTRO || "Ubuntu";

function sqzInvoke(args: readonly string[], opts: RunCommandOpts): ReturnType<typeof spawnCapture> {
  if (VIA_WSL) {
    // Translate cwd from Windows path → /mnt/c/... for WSL.
    const wslArgs = ["-d", WSL_DISTRO, "--", BIN, ...args];
    return spawnCapture("wsl", wslArgs, opts);
  }
  return spawnCapture(BIN, args, opts);
}

export const sqzAdapter: CompetitorAdapter = {
  id: "sqz",
  description: "sqz — Rust bash compressor with dedup (13-token refs).",
  async detect() {
    if (VIA_WSL) {
      const r = spawnCapture("wsl", ["-d", WSL_DISTRO, "--", BIN, "--version"], { timeoutMs: 10_000 });
      if (r.exitCode === 0) {
        const version = (r.stdoutText + r.stderrText).split(/\r?\n/)[0]?.trim() || "unknown";
        return { available: true, version: `${version} (via WSL ${WSL_DISTRO})` };
      }
      return { available: false, reason: `sqz not found in WSL ${WSL_DISTRO}. Inside WSL: cargo install sqz-cli` };
    }
    const bin = which(BIN);
    if (!bin) return { available: false, reason: `${BIN} not on PATH. Install: cargo install sqz-cli OR set SQZ_VIA_WSL=1` };
    const r = spawnCapture(bin, ["--version"], { timeoutMs: 5000 });
    const combined = (r.stdoutText + r.stderrText).trim();
    if (r.exitCode !== 0 || /node:internal\/modules|MODULE_NOT_FOUND|Cannot find module/.test(combined)) {
      return { available: false, reason: `${BIN} install is broken on this platform (npm shim or cargo build fails). Try SQZ_VIA_WSL=1 to invoke via WSL.` };
    }
    const version = combined.split(/\r?\n/)[0]?.trim() || "unknown";
    return { available: true, version, installSizeBytes: estimateInstallSize(BIN) };
  },
  async runCommand(cmd: string, opts: RunCommandOpts = {}): Promise<CompetitorRunResult> {
    // Try `sqz wrap <cmd>` first.
    let spawn = sqzInvoke(["wrap", cmd], opts);
    if (spawn.exitCode !== 0) {
      // Fall back: run via bash, pipe through `sqz filter` on stdin.
      const raw = runViaBash(cmd, opts);
      const piped = sqzInvoke(["filter"], {
        ...opts,
        stdin: raw.stdoutText + raw.stderrText,
        timeoutMs: 30_000,
      });
      spawn = piped.exitCode === 0 ? piped : spawn;
    }
    return spawnToRunResult("sqz", cmd.slice(0, 40), spawn, opts.keepOutput);
  },
  async readFile(path: string, opts: ReadFileOpts = {}): Promise<CompetitorRunResult> {
    const cmd = process.platform === "win32" ? `type "${path}"` : `cat "${path}"`;
    return this.runCommand!(cmd, { keepOutput: opts.keepOutput });
  },
};
