import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

export type DiffInventoryStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type changed"
  | "mode-only"
  | "binary"
  | "submodule"
  | "unmerged"
  | "conflict-marker-present"
  | "unknown";

export interface DiffProviderInfo {
  readonly name: "git-text" | "difftastic" | "tree-sitter";
  readonly version?: string;
  readonly status: "ok" | "fallback" | "failed";
  readonly fallbackReason?: string;
  readonly elapsedMs: number;
  readonly maxInputBytes: number;
  readonly supportedFileCount?: number;
  readonly unsupportedFileCount?: number;
}

export interface DiffInventoryItem {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: DiffInventoryStatus;
  readonly additions?: number;
  readonly deletions?: number;
  readonly binary?: boolean;
  readonly modeChange?: string;
  readonly submodule?: boolean;
}

export interface SemanticDiffGroup {
  readonly kind: "formatting" | "move" | "rename" | "api" | "test" | "generated" | "lockfile" | "textual" | "unknown";
  readonly files: readonly string[];
  readonly summary: string;
  readonly confidence: "low" | "medium" | "high";
}

export interface DiffRisk {
  readonly level: "low" | "medium" | "high";
  readonly reasonCodes: readonly string[];
  readonly summary: string;
}

export interface CtxDiffResult {
  readonly schemaVersion: 1;
  readonly provider: DiffProviderInfo;
  readonly inventory: readonly DiffInventoryItem[];
  readonly semanticGroups: readonly SemanticDiffGroup[];
  readonly risk: DiffRisk;
  readonly warnings: readonly string[];
  readonly semanticDiff?: string;
  readonly rawDiff?: string;
}

export interface CollectGitTextDiffOptions {
  readonly repoDir: string;
  readonly staged?: boolean;
  readonly maxInputBytes?: number;
  readonly includeRaw?: boolean;
  readonly semantic?: boolean;
  readonly difftasticCommand?: string;
}

function git(repoDir: string, args: readonly string[], maxBuffer: number): string {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    maxBuffer,
  });
}

function runDifftastic(repoDir: string, baseArgs: readonly string[], maxBuffer: number, command = "difft"): { version?: string; diff: string } {
  const version = execFileSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 2000,
    maxBuffer: 256 * 1024,
  }).trim().split(/\r?\n/)[0];
  const diff = execFileSync("git", ["-C", repoDir, "-c", `diff.external=${command}`, ...baseArgs, "--", "."], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    maxBuffer,
    env: {
      ...process.env,
      DFT_COLOR: "never",
      NO_COLOR: "1",
    },
  });
  return { version, diff };
}

function statusName(code: string): DiffInventoryStatus {
  const c = code[0] ?? "";
  if (c === "A") return "added";
  if (c === "M") return "modified";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  if (c === "C") return "copied";
  if (c === "T") return "type changed";
  if (c === "U") return "unmerged";
  return "unknown";
}

function parseNameStatusZ(out: string): DiffInventoryItem[] {
  const parts = out.split("\0").filter((part) => part.length > 0);
  const items: DiffInventoryItem[] = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++] ?? "";
    const status = statusName(code);
    if (status === "renamed" || status === "copied") {
      const oldPath = parts[i++] ?? "";
      const path = parts[i++] ?? oldPath;
      items.push({ path, oldPath, status });
    } else {
      const path = parts[i++] ?? "";
      if (path) items.push({ path, status });
    }
  }
  return items;
}

function parseNumstat(out: string): Map<string, { additions?: number; deletions?: number; binary?: boolean }> {
  const stats = new Map<string, { additions?: number; deletions?: number; binary?: boolean }>();
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [adds, dels, ...pathParts] = line.split(/\t/);
    const path = pathParts.join("\t");
    if (!path) continue;
    stats.set(path, {
      additions: adds === "-" ? undefined : Number(adds),
      deletions: dels === "-" ? undefined : Number(dels),
      binary: adds === "-" || dels === "-",
    });
  }
  return stats;
}

function detectModeChanges(summary: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of summary.split(/\r?\n/)) {
    const match = line.match(/ mode change (\d+) => (\d+) (.+)$/);
    if (match) map.set(match[3], `${match[1]}=>${match[2]}`);
  }
  return map;
}

function withStats(items: readonly DiffInventoryItem[], stats: Map<string, { additions?: number; deletions?: number; binary?: boolean }>, modes: Map<string, string>): DiffInventoryItem[] {
  return items.map((item) => {
    const stat = stats.get(item.path) ?? (item.oldPath ? stats.get(`${item.oldPath} => ${item.path}`) : undefined);
    const modeChange = modes.get(item.path);
    const status = modeChange && item.status === "modified" && !stat ? "mode-only" : item.status;
    return {
      ...item,
      status,
      ...(stat?.additions === undefined ? {} : { additions: stat.additions }),
      ...(stat?.deletions === undefined ? {} : { deletions: stat.deletions }),
      ...(stat?.binary ? { binary: true, status: "binary" as const } : {}),
      ...(modeChange ? { modeChange } : {}),
      ...(item.path.includes(".gitmodules") ? { submodule: true } : {}),
    };
  });
}

function isGenerated(path: string): boolean {
  return /(^|\/)(dist|build|coverage|generated|vendor)\//i.test(path)
    || /\.(bundle|gen|min)\.[cm]?[jt]s$/i.test(path);
}

function isLockfile(path: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|uv\.lock)$/i.test(path);
}

function isTest(path: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)\//i.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

function isApi(path: string): boolean {
  return /\b(api|route|controller|schema|contract|types?)\b/i.test(path) || /\.(d\.ts|proto|graphql|openapi\.ya?ml)$/i.test(path);
}

function group(kind: SemanticDiffGroup["kind"], files: string[], summary: string, confidence: SemanticDiffGroup["confidence"]): SemanticDiffGroup | null {
  return files.length ? { kind, files, summary, confidence } : null;
}

function semanticGroups(items: readonly DiffInventoryItem[]): SemanticDiffGroup[] {
  const files = items.map((item) => item.path);
  const groups = [
    group("rename", items.filter((item) => item.status === "renamed").map((item) => item.path), "Renamed paths detected; verify imports and references.", "high"),
    group("lockfile", files.filter(isLockfile), "Lockfiles changed; review dependency resolution separately.", "high"),
    group("generated", files.filter(isGenerated), "Generated or bundled files changed; raw diff may be noisy.", "medium"),
    group("test", files.filter(isTest), "Test files changed.", "high"),
    group("api", files.filter(isApi), "API/type/contract-shaped files changed; downstream compatibility risk may be higher.", "medium"),
    group("textual", files.filter((file) => !isLockfile(file) && !isGenerated(file) && !isTest(file) && !isApi(file)), "Regular textual/code changes.", "medium"),
  ];
  return groups.filter((item): item is SemanticDiffGroup => item !== null);
}

function riskFor(items: readonly DiffInventoryItem[], rawDiff: string | undefined): DiffRisk {
  const reasonCodes = new Set<string>();
  if (items.some((item) => item.binary)) reasonCodes.add("binary");
  if (items.some((item) => item.status === "deleted")) reasonCodes.add("deleted-files");
  if (items.some((item) => item.status === "renamed")) reasonCodes.add("renames");
  if (items.some((item) => isLockfile(item.path))) reasonCodes.add("lockfile");
  if (items.some((item) => isApi(item.path))) reasonCodes.add("api-surface");
  if (rawDiff && /^(<<<<<<<|=======|>>>>>>>) /m.test(rawDiff)) reasonCodes.add("conflict-marker-present");
  const churn = items.reduce((sum, item) => sum + (item.additions ?? 0) + (item.deletions ?? 0), 0);
  if (churn > 800) reasonCodes.add("large-churn");
  const high = ["binary", "deleted-files", "conflict-marker-present", "api-surface"].some((code) => reasonCodes.has(code));
  const medium = high || reasonCodes.size > 0 || churn > 200;
  const level = high ? "high" : medium ? "medium" : "low";
  return {
    level,
    reasonCodes: Array.from(reasonCodes).sort(),
    summary: `${items.length} file(s), ${churn} changed line(s), risk ${level}`,
  };
}

export function collectGitTextDiff(opts: CollectGitTextDiffOptions): CtxDiffResult {
  const started = Date.now();
  const maxInputBytes = opts.maxInputBytes ?? 2 * 1024 * 1024;
  const baseArgs = opts.staged ? ["diff", "--cached"] : ["diff"];
  const warnings: string[] = [];
  try {
    if (!existsSync(join(opts.repoDir, ".git"))) {
      warnings.push("repoDir does not contain a .git directory; git may still resolve via parent worktree");
    }
    const nameStatus = git(opts.repoDir, [...baseArgs, "--name-status", "-z"], maxInputBytes);
    const numstat = parseNumstat(git(opts.repoDir, [...baseArgs, "--numstat"], maxInputBytes));
    const summary = git(opts.repoDir, [...baseArgs, "--summary"], maxInputBytes);
    const inventory = withStats(parseNameStatusZ(nameStatus), numstat, detectModeChanges(summary));
    let rawDiff: string | undefined;
    let rawFallbackReason: string | undefined;
    let semanticDiff: string | undefined;
    let semanticFallbackReason: string | undefined;
    let providerName: DiffProviderInfo["name"] = "git-text";
    let providerVersion: string | undefined;
    if (opts.includeRaw) {
      try {
        rawDiff = git(opts.repoDir, [...baseArgs, "--", "."], maxInputBytes);
      } catch (err) {
        rawFallbackReason = err instanceof Error ? err.message : String(err);
        warnings.push(`raw diff omitted: ${rawFallbackReason}`);
      }
    }
    if (opts.semantic) {
      try {
        const difftastic = runDifftastic(opts.repoDir, baseArgs, maxInputBytes, opts.difftasticCommand);
        providerName = "difftastic";
        providerVersion = difftastic.version;
        semanticDiff = difftastic.diff;
      } catch (err) {
        semanticFallbackReason = err instanceof Error ? err.message : String(err);
        warnings.push(`difftastic unavailable; using git-text summary: ${semanticFallbackReason}`);
      }
    }
    const groups = semanticGroups(inventory);
    const fallbackReason = rawFallbackReason ?? semanticFallbackReason;
    return {
      schemaVersion: 1,
      provider: {
        name: providerName,
        status: fallbackReason ? "fallback" : "ok",
        ...(providerVersion ? { version: providerVersion } : {}),
        ...(fallbackReason ? { fallbackReason } : {}),
        elapsedMs: Date.now() - started,
        maxInputBytes,
        supportedFileCount: inventory.filter((item) => !item.binary && item.status !== "submodule" && item.status !== "unmerged").length,
        unsupportedFileCount: inventory.filter((item) => item.binary || item.status === "submodule" || item.status === "unmerged").length,
      },
      inventory,
      semanticGroups: groups,
      risk: riskFor(inventory, rawDiff),
      warnings,
      ...(semanticDiff === undefined ? {} : { semanticDiff }),
      ...(rawDiff === undefined ? {} : { rawDiff }),
    };
  } catch (err) {
    return {
      schemaVersion: 1,
      provider: {
        name: "git-text",
        status: "failed",
        fallbackReason: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - started,
        maxInputBytes,
      },
      inventory: [],
      semanticGroups: [],
      risk: { level: "medium", reasonCodes: ["provider-failed"], summary: "git-text provider failed" },
      warnings: [err instanceof Error ? err.message : String(err)],
    };
  }
}

export function renderDiffSummary(result: CtxDiffResult): string {
  const lines = [
    `ctx_diff ${result.provider.status}`,
    `provider: ${result.provider.name}`,
    `risk: ${result.risk.level} (${result.risk.reasonCodes.join(", ") || "none"})`,
    `files: ${result.inventory.length}`,
  ];
  if (result.inventory.length > 0) {
    lines.push("", "Inventory:");
    for (const item of result.inventory.slice(0, 50)) {
      const stat = item.additions !== undefined || item.deletions !== undefined
        ? ` +${item.additions ?? "?"}/-${item.deletions ?? "?"}`
        : "";
      const old = item.oldPath ? ` from ${item.oldPath}` : "";
      lines.push(`- ${item.status} ${item.path}${old}${stat}${item.binary ? " binary" : ""}`);
    }
  }
  if (result.semanticGroups.length > 0) {
    lines.push("", "Semantic groups:");
    for (const semantic of result.semanticGroups) {
      const names = semantic.files.slice(0, 8).map((file) => basename(file)).join(", ");
      lines.push(`- ${semantic.kind}: ${semantic.files.length} file(s) ${names} — ${semantic.summary}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

export function summarizePathKind(path: string): string {
  if (isLockfile(path)) return "lockfile";
  if (isGenerated(path)) return "generated";
  if (isTest(path)) return "test";
  if (isApi(path)) return "api";
  return extname(path).replace(/^\./, "") || "text";
}
