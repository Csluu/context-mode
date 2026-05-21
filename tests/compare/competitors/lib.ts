// Shared types + runners for competitor comparison harness.
// Each competitor adapter exports a Competitor object. Workflows are pure data.
// Runner executes each adapter on each workflow and persists results.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type CompetitorId =
  | "raw"
  | "naive-truncate"
  | "fork"
  | "fork-intent"
  | "upstream"
  | "lean-ctx"
  | "lean-ctx-aggressive"
  | "context-compress"
  | "context-compress-aggressive"
  | "squeez"
  | "sqz"
  | "chop";

export interface CompetitorRunResult {
  readonly tool: CompetitorId;
  readonly stepLabel: string;
  readonly ms: number;
  readonly bytes: number;
  readonly tokens: number;
  readonly ok: boolean;
  readonly errorReason?: string;
  readonly output?: string;        // captured only when keepOutput=true (small samples)
  readonly fallbackUsed?: boolean; // true when adapter errored and runner retried via raw
  readonly originalAdapterError?: string; // adapter's error before fallback fired
  readonly oracleOk?: boolean;     // oracle assert result, if step had one
  readonly oracleIssues?: readonly string[];
}

export interface CompetitorWorkflowResult {
  readonly tool: CompetitorId;
  readonly workflow: string;
  readonly totalBytes: number;
  readonly totalTokens: number;
  readonly totalMs: number;
  readonly steps: readonly CompetitorRunResult[];
  readonly available: boolean;     // false when adapter detected tool missing
  readonly skipReason?: string;
}

export interface RunCommandOpts {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly stdin?: string;
  readonly keepOutput?: boolean;
}

export interface ReadFileOpts {
  readonly mode?: "full" | "map" | "outline" | "slice";
  readonly start?: number;
  readonly end?: number;
  readonly compact?: boolean;
  readonly keepOutput?: boolean;
}

export interface FetchUrlOpts {
  readonly keepOutput?: boolean;
}

export interface SearchOpts {
  readonly source?: string;
  readonly keepOutput?: boolean;
}

export interface IndexOpts {
  readonly path?: string;
  readonly command?: string;
  readonly source: string;
  readonly timeoutMs?: number;
  readonly keepOutput?: boolean;
}

export interface CompetitorAdapter {
  readonly id: CompetitorId;
  readonly description: string;
  detect(): Promise<{ available: boolean; version?: string; reason?: string; installSizeBytes?: number }>;
  calibrate?(): Promise<{ ok: boolean; reason?: string }>;
  runCommand(cmd: string, opts?: RunCommandOpts): Promise<CompetitorRunResult>;
  readFile?(path: string, opts?: ReadFileOpts): Promise<CompetitorRunResult>;
  fetchUrl?(url: string, opts?: FetchUrlOpts): Promise<CompetitorRunResult>;
  search?(query: string, opts?: SearchOpts): Promise<CompetitorRunResult>;
  index?(opts: IndexOpts): Promise<CompetitorRunResult>;
}

const CHARS_PER_TOKEN = 4;
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `cm-compete-${prefix}-`));
}

export function safeRm(dir: string | null): void {
  if (!dir) return;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

export function writeStdinFile(content: string, dir: string): string {
  const file = join(dir, `stdin-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
  writeFileSync(file, content);
  return file;
}

export interface SpawnResult {
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutText: string;
  readonly stderrText: string;
  readonly ms: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

export function spawnCapture(
  cmd: string,
  args: readonly string[],
  opts: RunCommandOpts & { shell?: boolean } = {},
): SpawnResult {
  const started = Date.now();
  // Windows + Node 18+ refuse to spawn .cmd/.bat shims with shell:false
  // (CVE-2024-27980 hardened the loader). Route via `cmd.exe /c "<shim>" ...`
  // so cmd.exe handles arg parsing and we stay shell:false (avoids the
  // double-quoting hell of Node's shell:true on Win).
  let effectiveCmd = cmd;
  let effectiveArgs: readonly string[] = args;
  let needsShell = opts.shell ?? false;
  if (!opts.shell && process.platform === "win32") {
    if (/\.(cmd|bat)$/i.test(cmd)) {
      effectiveCmd = process.env.ComSpec ?? "cmd.exe";
      effectiveArgs = ["/d", "/s", "/c", cmd, ...args];
    } else if (!cmd.includes("\\") && !cmd.includes("/")) {
      // Bare binary name — let cmd.exe resolve from PATH (handles npm shims).
      effectiveCmd = process.env.ComSpec ?? "cmd.exe";
      effectiveArgs = ["/d", "/s", "/c", cmd, ...args];
    }
  }
  let r: SpawnSyncReturns<Buffer>;
  try {
    r = spawnSync(effectiveCmd, effectiveArgs as string[], {
      encoding: "buffer",
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs ?? 60_000,
      input: opts.stdin,
      shell: needsShell,
      maxBuffer: 200 * 1024 * 1024,
      windowsVerbatimArguments: false,
    });
  } catch (err) {
    return {
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutText: "",
      stderrText: "",
      ms: Date.now() - started,
      exitCode: null,
      signal: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
  const stdoutBuf = r.stdout ?? Buffer.alloc(0);
  const stderrBuf = r.stderr ?? Buffer.alloc(0);
  return {
    stdoutBytes: stdoutBuf.length,
    stderrBytes: stderrBuf.length,
    stdoutText: stdoutBuf.toString("utf8"),
    stderrText: stderrBuf.toString("utf8"),
    ms: Date.now() - started,
    exitCode: r.status,
    signal: r.signal,
    error: r.error,
  };
}

export function spawnShellCapture(cmdline: string, opts: RunCommandOpts = {}): SpawnResult {
  // Routes through the platform shell. Use sparingly — for raw baseline only,
  // or where the competitor requires shell metacharacters.
  return spawnCapture(cmdline, [], { ...opts, shell: true });
}

// Tools whose installers drop binaries OUTSIDE the default PATH. When `where`
// fails, fall back to checking these well-known locations.
function knownInstallPaths(bin: string): string[] {
  if (process.platform !== "win32") return [];
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const localApp = process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
  const roamingApp = process.env.APPDATA ?? `${home}\\AppData\\Roaming`;
  switch (bin) {
    case "chop": return [`${localApp}\\Programs\\chop\\chop.exe`];
    case "lean-ctx": return [`${home}\\bin\\lean-ctx\\lean-ctx.exe`, `${home}\\.cargo\\bin\\lean-ctx.exe`];
    case "squeez": return [`${roamingApp}\\npm\\squeez.cmd`];
    case "context-compress": return [`${roamingApp}\\npm\\context-compress.cmd`];
    case "sqz": return [`${home}\\.cargo\\bin\\sqz.exe`];
    default: return [];
  }
}

export function which(bin: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, [bin], { encoding: "utf8", shell: false });
  if (r.status === 0) {
    const out = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    // On Windows, prefer executable shims (.cmd/.bat/.exe) over extensionless
    // files. spawnSync with shell:false can't execute extensionless shims.
    if (process.platform === "win32") {
      const exe = out.find((p) => /\.(cmd|bat|exe)$/i.test(p));
      if (exe) return exe;
    }
    if (out[0]) return out[0];
  }
  // Fallback: probe known install locations.
  for (const candidate of knownInstallPaths(bin)) {
    try { if (existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  return null;
}

/**
 * Best-effort install size for a CLI tool. Walks the binary's directory
 * (one level — sufficient for shim-style installs where the real package
 * is alongside). Returns 0 if anything fails. Lower-bound estimate.
 */
export function estimateInstallSize(bin: string): number {
  try {
    const binPath = which(bin);
    if (!binPath) return 0;
    const dir = dirname(binPath);
    const entries = readdirSync(dir, { withFileTypes: true });
    let total = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      try { total += statSync(join(dir, e.name)).size; } catch { /* ignore */ }
    }
    return total;
  } catch { return 0; }
}

export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Wrap a SpawnResult into a CompetitorRunResult with byte/token totals.
 * Both stdout and stderr count — competitors that put output on stderr
 * still consume the agent's context window.
 */
export function spawnToRunResult(
  tool: CompetitorId,
  stepLabel: string,
  spawn: SpawnResult,
  keepOutput = false,
): CompetitorRunResult {
  const bytes = spawn.stdoutBytes + spawn.stderrBytes;
  const tokens = estimateTokens(bytes);
  const ok = spawn.error === undefined && spawn.exitCode !== null;
  return {
    tool,
    stepLabel,
    ms: spawn.ms,
    bytes,
    tokens,
    ok,
    errorReason: spawn.error?.message ?? (spawn.exitCode !== 0 && spawn.exitCode !== null ? `exit=${spawn.exitCode}` : undefined),
    output: keepOutput ? `${spawn.stdoutText}${spawn.stderrText}`.slice(0, 4000) : undefined,
  };
}

/**
 * Bash runner: prefers bash on Windows (Git Bash present), falls back to
 * platform shell. Used by the raw baseline when commands include POSIX-only
 * syntax (subshells, $(...), for-loops, etc).
 */
export function runViaBash(cmdline: string, opts: RunCommandOpts = {}): SpawnResult {
  if (isWindows()) {
    const bash = which("bash");
    if (bash) {
      return spawnCapture(bash, ["-c", cmdline], opts);
    }
  }
  return spawnShellCapture(cmdline, opts);
}

export function ensureExists(path: string, what: string): void {
  if (!existsSync(path)) throw new Error(`${what} not found at: ${path}`);
}
