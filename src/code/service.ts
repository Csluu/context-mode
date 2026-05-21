import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { ctxRead } from "../read/ctx-read.js";
import { isInsideOrSame, resolveReadTargetPath } from "../read/read-policy.js";
import { hashProjectDirCanonical } from "../session/db.js";
import { CODE_INDEX_SCHEMA_VERSION, parseCodeFile, parserIdentityForCodePath, supportedCodePath } from "./parser.js";
import { CodeIndexStore } from "./index-store.js";
import type { CodeImportRecord, CodeIndexFreshness, CodeIndexMatch, CodeSymbolRecord, ParsedCodeFile } from "./types.js";

const MAX_INDEX_FILE_BYTES = 1_500_000;
const MAX_TEXT_SCAN_FILE_BYTES = 1_500_000;
const MAX_PROJECT_FILES = 3_000;
const SKIP_DIRS = new Set([
  ".git",
  ".context-mode",
  ".compare",
  ".serena",
  "node_modules",
  "build",
  "dist",
  "coverage",
  "release-artifacts",
  "graphify-out",
]);

export interface CodeIndexPolicy {
  readonly checkFilePath?: (filePath: string, projectDir: string) => string | null;
}

export interface CodeIndexServiceOptions {
  readonly projectDir: string;
  readonly store: CodeIndexStore;
  readonly policy?: CodeIndexPolicy;
}

export interface EnsureIndexResult {
  readonly projectKey: string;
  readonly freshness: CodeIndexFreshness;
}

export interface ReadSymbolResult {
  readonly status: "ok" | "ambiguous" | "not-found";
  readonly freshness: CodeIndexFreshness;
  readonly matches: readonly CodeIndexMatch[];
  readonly text?: string;
}

export interface FileOutlineResult {
  readonly filePath: string;
  readonly freshness: CodeIndexFreshness;
  readonly symbols: readonly CodeSymbolRecord[];
}

export interface RefLightResult {
  readonly freshness: CodeIndexFreshness;
  readonly definition?: CodeIndexMatch;
  readonly matches: readonly {
    readonly filePath: string;
    readonly line: number;
    readonly snippet: string;
    readonly confidence: "high" | "medium" | "low";
    readonly reason: string;
  }[];
  readonly omitted: number;
}

export interface RelatedFilesResult {
  readonly filePath: string;
  readonly freshness: CodeIndexFreshness;
  readonly imports: readonly CodeImportRecord[];
  readonly importedFiles: readonly string[];
  readonly importers: readonly CodeImportRecord[];
  readonly likelyTests: readonly string[];
}

export class CodeIndexService {
  readonly #projectDir: string;
  readonly #projectRoot: string;
  readonly #projectKey: string;
  readonly #store: CodeIndexStore;
  readonly #policy?: CodeIndexPolicy;

  constructor(options: CodeIndexServiceOptions) {
    this.#projectDir = resolve(options.projectDir);
    this.#projectRoot = realpathSync(this.#projectDir);
    this.#projectKey = hashProjectDirCanonical(this.#projectRoot);
    this.#store = options.store;
    this.#policy = options.policy;
    this.#store.upsertProjectMeta(this.#projectKey, this.#projectRoot, CODE_INDEX_SCHEMA_VERSION);
  }

  get projectKey(): string {
    return this.#projectKey;
  }

  ensureProjectIndexed(): EnsureIndexResult {
    const files = scanProjectFiles(this.#projectRoot);
    const seen = new Set<string>();
    const freshness = emptyFreshness();
    for (const filePath of files) {
      seen.add(toProjectRelative(this.#projectRoot, filePath));
      const result = this.indexFile(filePath);
      addFreshness(freshness, result);
    }
    if (files.length < MAX_PROJECT_FILES) {
      for (const indexedPath of this.#store.listFilePaths(this.#projectKey)) {
        if (!seen.has(indexedPath)) this.#store.markFileDeleted(this.#projectKey, indexedPath);
      }
    }
    return { projectKey: this.#projectKey, freshness };
  }

  ensureFileIndexed(inputPath: string): EnsureIndexResult & { filePath: string } {
    const realPath = this.resolveSafeFile(inputPath);
    const freshness = this.indexFile(realPath);
    return { projectKey: this.#projectKey, freshness, filePath: toProjectRelative(this.#projectRoot, realPath) };
  }

  findSymbols(query: string, opts: { kind?: string; file?: string; limit?: number } = {}): {
    readonly freshness: CodeIndexFreshness;
    readonly matches: readonly CodeIndexMatch[];
  } {
    const freshness = opts.file
      ? this.ensureFileIndexed(opts.file).freshness
      : this.ensureProjectIndexed().freshness;
    const filePath = opts.file ? toProjectRelative(this.#projectRoot, this.resolveSafeFile(opts.file)) : undefined;
    return {
      freshness,
      matches: this.#store.findSymbols(this.#projectKey, query, {
        kind: opts.kind,
        filePath,
        limit: opts.limit ?? 20,
      }),
    };
  }

  fileOutline(inputPath: string): FileOutlineResult {
    const indexed = this.ensureFileIndexed(inputPath);
    return {
      filePath: indexed.filePath,
      freshness: indexed.freshness,
      symbols: this.#store.symbolsForFile(this.#projectKey, indexed.filePath),
    };
  }

  readSymbol(query: string, opts: { file?: string; kind?: string; limit?: number; includeImports?: boolean } = {}): ReadSymbolResult {
    const found = this.findSymbols(query, { file: opts.file, kind: opts.kind, limit: opts.limit ?? 10 });
    if (found.matches.length === 0) {
      return { status: "not-found", freshness: found.freshness, matches: [] };
    }
    if (found.matches.length > 1 && !opts.file) {
      return { status: "ambiguous", freshness: found.freshness, matches: found.matches };
    }
    const match = found.matches[0];
    const filePath = match.file?.realPath ?? resolve(this.#projectRoot, match.filePath);
    const result = ctxRead({
      projectDir: this.#projectRoot,
      path: filePath,
      mode: "slice",
      start: match.startLine,
      end: match.endLine,
      compact: true,
    });
    const imports = opts.includeImports
      ? this.#store.importsForFile(this.#projectKey, match.filePath).slice(0, 20)
      : [];
    const header = [
      `ctx_code read_symbol: ${match.qualifiedName}`,
      `${match.confidence.toUpperCase()} ${match.filePath}:${match.startLine}-${match.endLine} ${match.kind} ${match.exportStatus}`,
      imports.length > 0 ? `imports: ${imports.map((imp) => `${imp.localName ?? imp.importedName ?? "*"} from ${imp.source}`).join(", ")}` : "",
      "",
    ].filter(Boolean).join("\n");
    return {
      status: "ok",
      freshness: found.freshness,
      matches: [match],
      text: `${header}\n${result.text}`,
    };
  }

  refsLight(symbol: string, opts: { file?: string; limit?: number } = {}): RefLightResult {
    const found = this.findSymbols(symbol, { file: opts.file, limit: 5 });
    const definition = found.matches[0];
    const files = scanProjectFiles(this.#projectRoot);
    const max = opts.limit ?? 40;
    const matches: Array<RefLightResult["matches"][number]> = [];
    const word = new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
    const definitionDir = definition ? dirname(definition.filePath).replace(/\\/g, "/") : "";
    for (const file of files) {
      if (matches.length >= max) break;
      const denied = this.denialForFile(file);
      if (denied) continue;
      if (!safeTextScanFile(file)) continue;
      let text = "";
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      const rel = toProjectRelative(this.#projectRoot, file);
      const lines = text.split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        if (!word.test(line)) continue;
        if (definition && rel === definition.filePath && i + 1 === definition.startLine) continue;
        const sameFile = definition && rel === definition.filePath;
        const sameDir = definitionDir && dirname(rel).replace(/\\/g, "/") === definitionDir;
        const classified = classifyTextualRef(line, sameFile ? "high" : sameDir ? "medium" : "low");
        matches.push({
          filePath: rel,
          line: i + 1,
          snippet: line.trim().slice(0, 180),
          confidence: classified.confidence,
          reason: classified.reason ?? (sameFile ? "same-file textual match" : sameDir ? "same-directory textual match" : "textual match"),
        });
        if (matches.length >= max) break;
      }
    }
    let total = matches.length;
    if (matches.length >= max) {
      total = countTextualMatches(files, this.#projectRoot, symbol, this.#policy);
    }
    return {
      freshness: found.freshness,
      definition,
      matches,
      omitted: Math.max(0, total - matches.length),
    };
  }

  relatedFiles(inputPath: string, opts: { testLimit?: number } = {}): RelatedFilesResult {
    const indexed = this.ensureFileIndexed(inputPath);
    const target = indexed.filePath;
    const files = scanProjectFiles(this.#projectRoot);
    const indexedPaths = new Set(files.map((file) => toProjectRelative(this.#projectRoot, file)));
    const freshness = emptyFreshness();
    addFreshness(freshness, indexed.freshness);
    const imports = this.#store.importsForFile(this.#projectKey, target);
    const importedFiles = Array.from(new Set(imports
      .map((imp) => resolveLocalImportPath(target, imp.source, indexedPaths))
      .filter((filePath): filePath is string => Boolean(filePath))));
    for (const importedFile of importedFiles.slice(0, 20)) {
      try { addFreshness(freshness, this.indexFile(resolve(this.#projectRoot, importedFile))); } catch { /* skip vanished related file */ }
    }
    const importers: CodeImportRecord[] = [];
    const persistedImporters = new Set<string>();
    for (const file of files) {
      if (importers.length >= 20) break;
      const filePath = toProjectRelative(this.#projectRoot, file);
      if (filePath === target) continue;
      if (this.denialForFile(file) || !safeTextScanFile(file)) continue;
      for (const imp of quickImportRows(file, filePath)) {
        if (resolveLocalImportPath(filePath, imp.source, indexedPaths) !== target) continue;
        importers.push(imp);
        if (!persistedImporters.has(filePath)) {
          persistedImporters.add(filePath);
          try { addFreshness(freshness, this.indexFile(file)); } catch { /* skip vanished importer */ }
        }
        if (importers.length >= 20) break;
      }
    }
    return {
      filePath: target,
      freshness,
      imports,
      importedFiles,
      importers,
      likelyTests: likelyTestsForFile(target, indexedPaths, opts.testLimit ?? 8),
    };
  }

  indexFile(filePath: string): CodeIndexFreshness {
    const freshness = emptyFreshness();
    freshness.checked++;
    const realPath = this.resolveSafeFile(filePath);
    const relPath = toProjectRelative(this.#projectRoot, realPath);
    const denial = this.denialForFile(realPath);
    if (denial) {
      this.#store.recordDenial(this.#projectKey, relPath, realPath, policyHash(denial), denial);
      this.#store.markFileDeleted(this.#projectKey, relPath);
      freshness.denied++;
      return freshness;
    }
    const stat = statSync(realPath);
    if (!stat.isFile() || stat.size > MAX_INDEX_FILE_BYTES || !supportedCodePath(realPath)) {
      this.#store.markFileDeleted(this.#projectKey, relPath);
      freshness.skipped++;
      return freshness;
    }
    const existing = this.#store.getFile(this.#projectKey, relPath);
    const parserIdentity = parserIdentityForCodePath(realPath);
    if (
      existing
      && existing.schemaVersion === CODE_INDEX_SCHEMA_VERSION
      && existing.parser === parserIdentity?.parser
      && existing.parserVersion === parserIdentity?.parserVersion
      && existing.sizeBytes === stat.size
      && existing.mtimeMs === stat.mtimeMs
    ) {
      freshness.reused++;
      return freshness;
    }
    const parsed = this.readAndParseStable(realPath, relPath);
    if (existing?.contentHash === parsed.contentHash && existing.schemaVersion === parsed.schemaVersion) {
      this.#store.replaceFileFacts(this.#projectKey, parsed);
      freshness.reused++;
      return freshness;
    }
    this.#store.replaceFileFacts(this.#projectKey, parsed);
    freshness.parsed++;
    return freshness;
  }

  private resolveSafeFile(inputPath: string): string {
    const resolved = isAbsolute(inputPath)
      ? resolveReadTargetPath(inputPath, this.#projectRoot)
      : resolveReadTargetPath(inputPath, this.#projectRoot);
    const real = existsSync(resolved) ? realpathSync(resolved) : resolved;
    if (!isInsideOrSame(this.#projectRoot, real)) {
      throw new Error(`file path escapes project root: ${inputPath}`);
    }
    return real;
  }

  private denialForFile(filePath: string): string | null {
    return this.#policy?.checkFilePath?.(filePath, this.#projectRoot) ?? null;
  }

  private readAndParseStable(realPath: string, relPath: string): ParsedCodeFile {
    let before = statSync(realPath);
    let buffer = readFileSync(realPath);
    let after = statSync(realPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      before = after;
      buffer = readFileSync(realPath);
      after = statSync(realPath);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error(`file changed while indexing: ${relPath}`);
      }
    }
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    return parseCodeFile({
      relPath,
      realPath,
      content: buffer.toString("utf8"),
      sizeBytes: after.size,
      mtimeMs: after.mtimeMs,
      contentHash,
    });
  }
}

function scanProjectFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    if (out.length >= MAX_PROJECT_FILES) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= MAX_PROJECT_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (!supportedCodePath(full)) continue;
        try {
          const lst = lstatSync(full);
          if (lst.isSymbolicLink()) {
            const real = realpathSync(full);
            if (!isInsideOrSame(root, real)) continue;
          }
          out.push(full);
        } catch { /* skip vanished files */ }
      }
    }
  }
  walk(root);
  return out;
}

function toProjectRelative(root: string, filePath: string): string {
  return relative(root, filePath).replace(/\\/g, "/");
}

function emptyFreshness(): { checked: number; reused: number; parsed: number; denied: number; skipped: number } {
  return { checked: 0, reused: 0, parsed: 0, denied: 0, skipped: 0 };
}

function addFreshness(target: ReturnType<typeof emptyFreshness>, source: CodeIndexFreshness): void {
  target.checked += source.checked;
  target.reused += source.reused;
  target.parsed += source.parsed;
  target.denied += source.denied;
  target.skipped += source.skipped;
}

function policyHash(reason: string): string {
  return createHash("sha256").update(reason).digest("hex").slice(0, 16);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyTextualRef(line: string, base: "high" | "medium" | "low"): {
  readonly confidence: "high" | "medium" | "low";
  readonly reason?: string;
} {
  const trimmed = line.trim();
  if (/^(\/\/|\/\*|\*|#)/.test(trimmed)) {
    return { confidence: "low", reason: "comment textual match" };
  }
  return { confidence: base };
}

function countTextualMatches(
  files: readonly string[],
  root: string,
  symbol: string,
  policy?: CodeIndexPolicy,
): number {
  const word = new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
  let total = 0;
  for (const file of files) {
    if (policy?.checkFilePath?.(file, root)) continue;
    if (!safeTextScanFile(file)) continue;
    try {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) if (word.test(line)) total++;
    } catch { /* skip vanished files */ }
  }
  return total;
}

function resolveLocalImportPath(fromFile: string, source: string, indexedPaths: ReadonlySet<string>): string | null {
  if (!source.startsWith(".")) return null;
  const base = join(dirname(fromFile), source).replace(/\\/g, "/");
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.rs`,
    `${base}/mod.rs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ].map((candidate) => candidate.replace(/\\/g, "/").replace(/^\.\//, ""));
  return candidates.find((candidate) => indexedPaths.has(candidate)) ?? null;
}

function likelyTestsForFile(target: string, indexedPaths: ReadonlySet<string>, limit: number): string[] {
  const normalized = target.replace(/\\/g, "/");
  const targetDir = dirname(normalized).replace(/\\/g, "/");
  const base = normalized.split("/").pop()?.replace(/\.[^.]+$/, "") ?? normalized;
  const scored: Array<{ filePath: string; score: number }> = [];
  for (const filePath of indexedPaths) {
    const path = filePath.replace(/\\/g, "/");
    if (!/(^|\/)(__tests__|tests?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|_test\.rs$/i.test(path)) continue;
    let score = 0;
    if (path.includes(base)) score += 10;
    if (dirname(path).replace(/\\/g, "/") === targetDir) score += 5;
    if (path.includes(targetDir)) score += 3;
    if (path.endsWith(`/${base}.test.ts`) || path.endsWith(`/${base}.spec.ts`) || path.endsWith(`/${base}_test.rs`)) score += 6;
    if (score > 0) scored.push({ filePath: path, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .slice(0, limit)
    .map((item) => item.filePath);
}

function quickImportRows(realPath: string, filePath: string): CodeImportRecord[] {
  let text = "";
  if (!safeTextScanFile(realPath)) return [];
  try { text = readFileSync(realPath, "utf8"); } catch { return []; }
  const rows: CodeImportRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const rustMod = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][\w]*)\s*;/.exec(line);
    if (rustMod) {
      rows.push({
        filePath,
        source: `./${rustMod[1]}`,
        importedName: rustMod[1],
        localName: rustMod[1],
        line: index + 1,
        kind: "rust-mod",
        confidence: "medium",
      });
      continue;
    }
    const match =
      /\bfrom\s+["']([^"']+)["']/.exec(line) ??
      /\bimport\s*\(?\s*["']([^"']+)["']/.exec(line) ??
      /\brequire\(\s*["']([^"']+)["']\s*\)/.exec(line);
    const source = match?.[1];
    if (!source?.startsWith(".")) continue;
    rows.push({
      filePath,
      source,
      importedName: null,
      localName: null,
      line: index + 1,
      kind: /\bexport\b/.test(line) && /\bfrom\b/.test(line) ? "re-export" : "textual-import",
      confidence: "medium",
    });
  }
  return rows;
}

function safeTextScanFile(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    return stat.isFile() && stat.size <= MAX_TEXT_SCAN_FILE_BYTES;
  } catch {
    return false;
  }
}
