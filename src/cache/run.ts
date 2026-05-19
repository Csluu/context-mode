import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { redactText } from "../filters/pipeline.js";
import { scanGuardText } from "../guard/scanner.js";
import { explainTaskCache, type CacheExplainResult } from "./explain.js";

export type TaskCacheStatus = "hit" | "miss" | "bypass";

export interface TaskCacheEntry {
  readonly schemaVersion: 1;
  readonly cacheKey: string;
  readonly createdAt: string;
  readonly commandFamily: string;
  readonly commandShape: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly sha256: string;
}

export interface TaskCacheRunResult {
  readonly schemaVersion: 1;
  readonly status: TaskCacheStatus;
  readonly explain: CacheExplainResult;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly cachePath?: string;
  readonly reasonCodes: readonly string[];
  readonly wroteEntry: boolean;
}

export interface RunTaskCachedOptions {
  readonly command: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly maxEntryBytes?: number;
}

const DEFAULT_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const SERVING_FAMILIES = new Set(["tsc-noemit"]);
const require = createRequire(import.meta.url);

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function assertInside(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`))) return;
  throw new Error(`task cache path escapes root: ${target}`);
}

export function getTaskCacheRoot(projectDir: string): string {
  const root = resolve(projectDir, ".context-mode", "task-cache");
  assertInside(resolve(projectDir), root);
  return root;
}

function cachePath(projectDir: string, cacheKey: string): string {
  const root = getTaskCacheRoot(projectDir);
  const path = join(root, `${cacheKey}.json`);
  assertInside(root, path);
  return path;
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function readEntry(path: string): TaskCacheEntry | null {
  try {
    const entry = JSON.parse(readFileSync(path, "utf8")) as TaskCacheEntry;
    if (entry.schemaVersion !== 1 || !entry.cacheKey || typeof entry.stdout !== "string" || typeof entry.stderr !== "string") {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function approvedExecution(command: string, explain: CacheExplainResult): { command: string; args: string[] } | null {
  if (explain.commandFamily !== "tsc-noemit") return null;
  if (!/^\s*tsc\s+--noEmit\s*$/.test(command)) return null;
  try {
    return { command: process.execPath, args: [require.resolve("typescript/bin/tsc"), "--noEmit"] };
  } catch {
    return null;
  }
}

function executeApproved(argv: { command: string; args: string[] }, cwd: string, env: NodeJS.ProcessEnv, maxBuffer: number): { exitCode: number; stdout: string; stderr: string } {
  const child = spawnSync(argv.command, argv.args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer,
  });
  return {
    exitCode: typeof child.status === "number" ? child.status : child.signal ? 128 : 1,
    stdout: typeof child.stdout === "string" ? child.stdout : "",
    stderr: `${child.error ? `${child.error.message}\n` : ""}${typeof child.stderr === "string" ? child.stderr : ""}`,
  };
}

function entryFromRun(explain: CacheExplainResult, run: { exitCode: number; stdout: string; stderr: string }, now: Date): TaskCacheEntry {
  const stdout = redactText(run.stdout).text;
  const stderr = redactText(run.stderr).text;
  const payload = `${stdout}\0${stderr}\0${run.exitCode}`;
  return {
    schemaVersion: 1,
    cacheKey: explain.cacheKey ?? "",
    createdAt: now.toISOString(),
    commandFamily: explain.commandFamily,
    commandShape: explain.commandShape,
    exitCode: run.exitCode,
    stdout,
    stderr,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    sha256: sha256(payload),
  };
}

export function listTaskCacheEntries(projectDir: string): Array<{ path: string; entry: TaskCacheEntry }> {
  const root = getTaskCacheRoot(projectDir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = join(root, name);
      const entry = readEntry(path);
      return entry ? { path, entry } : null;
    })
    .filter((item): item is { path: string; entry: TaskCacheEntry } => item !== null)
    .sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt));
}

export function purgeTaskCache(projectDir: string, dryRun = true): { entries: number; bytes: number; paths: string[] } {
  const rows = listTaskCacheEntries(projectDir);
  const bytes = rows.reduce((sum, row) => {
    try {
      return sum + statSync(row.path).size;
    } catch {
      return sum;
    }
  }, 0);
  if (!dryRun) {
    for (const row of rows) rmSync(row.path, { force: true });
  }
  return { entries: rows.length, bytes, paths: rows.map((row) => row.path) };
}

export function runTaskCached(opts: RunTaskCachedOptions): TaskCacheRunResult {
  const env = opts.env ?? process.env;
  const explain = explainTaskCache({ command: opts.command, cwd: opts.cwd, env });
  const maxEntryBytes = Math.max(1, opts.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES);
  const reasons = [...explain.reasonCodes];
  const eligibleForServing = explain.decision === "eligible"
    && Boolean(explain.cacheKey)
    && SERVING_FAMILIES.has(explain.commandFamily);
  const approvedArgv = eligibleForServing ? approvedExecution(opts.command, explain) : null;

  if (!eligibleForServing || !approvedArgv) {
    return {
      schemaVersion: 1,
      status: "bypass",
      explain,
      exitCode: 126,
      stdout: "",
      stderr: "ctx_cache refused to execute a bypass or non-canonical command. Run it explicitly outside the task cache.",
      reasonCodes: reasons.includes("cache-serving-family-not-approved")
        ? reasons
        : [...reasons, approvedArgv ? "cache-serving-family-not-approved" : "cache-run-refused"],
      wroteEntry: false,
    };
  }

  const path = cachePath(opts.cwd, explain.cacheKey!);
  const cached = readEntry(path);
  if (cached) {
    const stdout = redactText(cached.stdout).text;
    const stderr = redactText(cached.stderr).text;
    return {
      schemaVersion: 1,
      status: "hit",
      explain,
      exitCode: cached.exitCode,
      stdout,
      stderr,
      cachePath: path,
      reasonCodes: ["cache-hit"],
      wroteEntry: false,
    };
  }

  const run = executeApproved(approvedArgv, opts.cwd, env, maxEntryBytes);
  const outputBytes = Buffer.byteLength(run.stdout) + Buffer.byteLength(run.stderr);
  if (outputBytes > maxEntryBytes) {
    return {
      schemaVersion: 1,
      status: "miss",
      explain,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      reasonCodes: ["cache-miss", "cache-entry-too-large"],
      wroteEntry: false,
    };
  }

  const guard = scanGuardText(`${run.stdout}\n${run.stderr}`, "cache");
  if (guard.status === "blocked" || guard.status === "unavailable") {
    return {
      schemaVersion: 1,
      status: "miss",
      explain,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      reasonCodes: ["cache-miss", "cache-output-blocked-by-guard"],
      wroteEntry: false,
    };
  }

  const entry = entryFromRun(explain, run, opts.now ?? new Date());
  writeAtomic(path, `${JSON.stringify(entry, null, 2)}\n`);
  return {
    schemaVersion: 1,
    status: "miss",
    explain,
    exitCode: run.exitCode,
    stdout: entry.stdout,
    stderr: entry.stderr,
    cachePath: path,
    reasonCodes: ["cache-miss", "cache-entry-written"],
    wroteEntry: true,
  };
}

export function renderTaskCacheList(projectDir: string): string {
  const rows = listTaskCacheEntries(projectDir);
  if (rows.length === 0) return "ctx_cache list: no task cache entries";
  return [
    `ctx_cache list: ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`,
    ...rows.map(({ path, entry }) => `- ${entry.commandFamily} ${entry.commandShape} exit=${entry.exitCode} ${basename(path)}`),
  ].join("\n");
}
