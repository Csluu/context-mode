import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { CodeIndexService } from "../code/service.js";
import { CodeIndexStore } from "../code/index-store.js";
import type { RelatedFilesResult, ReadSymbolResult, RefLightResult } from "../code/service.js";
import type { CodeIndexFreshness, CodeIndexMatch, CodeSymbolRecord } from "../code/types.js";
import { formatReadPolicyError } from "../read/read-policy.js";
import { resolveCodeIndexPath } from "../session/db.js";
import type { ToolContext, ToolDefinition } from "./types.js";

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

interface CodeDeps {
  readonly getProjectDir: () => string;
  readonly resolveProjectDirOverride?: (projectDir: string | undefined) => string | undefined;
  readonly checkFilePath?: (path: string, projectDir: string) => string | null;
}

interface CodeInput {
  readonly action?: "index" | "file_outline" | "find_symbol" | "read_symbol" | "refs_light" | "related_files" | "likely_tests" | "pack";
  readonly projectDir?: string;
  readonly query?: string;
  readonly symbol?: string;
  readonly file?: string;
  readonly pathGlob?: string;
  readonly kind?: string;
  readonly limit?: number;
  readonly budgetBytes?: number;
  readonly includeImports?: boolean;
  readonly confidenceFloor?: "high" | "medium" | "low";
  readonly compact?: boolean;
  readonly json?: boolean;
}

export function makeCtxCode(deps: CodeDeps): ToolDefinition<CodeInput, ToolTextResult> {
  return {
    name: "ctx_code",
    config: {
      title: "Static Code Navigation",
      description:
        "Static code index for symbol lookup, symbol reads, file outlines, context packs, and lightweight textual refs. No LSP or daemon.",
      inputSchema: z.object({
        action: z.enum(["index", "file_outline", "find_symbol", "read_symbol", "refs_light", "related_files", "likely_tests", "pack"]).optional().default("find_symbol"),
        projectDir: z.string().optional().describe("Project root override. Defaults to the active project root when unambiguous."),
        query: z.string().optional().describe("Symbol query for find_symbol/read_symbol"),
        symbol: z.string().optional().describe("Symbol name for read_symbol/refs_light; alias for query"),
        file: z.string().optional().describe("Optional project-relative or absolute file path to narrow indexing/search"),
        pathGlob: z.string().optional().describe("Reserved for future path filtering; currently ignored"),
        kind: z.string().optional().describe("Optional symbol kind filter such as function, class, interface, method"),
        limit: z.coerce.number().int().positive().max(200).optional().describe("Max returned matches"),
        budgetBytes: z.coerce.number().int().positive().max(16 * 1024).optional().describe("Hard output byte budget"),
        includeImports: z.boolean().optional().describe("Include compact import context when reading a symbol"),
        confidenceFloor: z.enum(["high", "medium", "low"]).optional().describe("Reserved for future filtering"),
        compact: z.boolean().optional().describe("Return terse output"),
        json: z.boolean().optional().describe("Return JSON"),
      }),
    },
    handler(input: CodeInput, ctx: ToolContext): ToolTextResult {
      let store: CodeIndexStore | null = null;
      try {
        const projectDir = resolveCodeProjectDir(input, deps);
        const dbPath = resolveCodeIndexPath({ projectDir, sessionsDir: ctx.getSessionDir() });
        mkdirSync(dirname(dbPath), { recursive: true });
        store = new CodeIndexStore(dbPath);
        const service = new CodeIndexService({
          projectDir,
          store,
          policy: {
            checkFilePath: (path, root) => deps.checkFilePath?.(path, root) ?? null,
          },
        });
        const action = input.action ?? "find_symbol";
        const budget = input.budgetBytes ?? defaultBudget(action);

        if (action === "index") {
          const result = input.file ? service.ensureFileIndexed(input.file) : service.ensureProjectIndexed();
          return textResult(renderPayload(input, {
            action,
            projectDir,
            dbPath,
            projectKey: result.projectKey,
            freshness: result.freshness,
          }, `ctx_code index\n${renderFreshness(result.freshness)}\ndb: ${dbPath}`, budget), budget);
        }

        if (action === "file_outline") {
          if (!input.file) return errorResult("CTX_CODE_FILE_REQUIRED: file_outline requires file.");
          const outline = service.fileOutline(input.file);
          const text = renderFileOutline(outline.filePath, outline.symbols, outline.freshness, input.compact ?? false, input.limit ?? 80);
          return textResult(renderPayload(input, outline, text, budget), budget);
        }

        const query = (input.query ?? input.symbol ?? "").trim();
        if (!query && action !== "pack" && action !== "related_files" && action !== "likely_tests") {
          return errorResult(`CTX_CODE_QUERY_REQUIRED: ${action} requires query or symbol.`);
        }

        if (action === "find_symbol") {
          const found = service.findSymbols(query, { file: input.file, kind: input.kind, limit: input.limit ?? 10 });
          const text = renderFindSymbols(query, found.matches, found.freshness, input.limit ?? 10, input.compact ?? false);
          return textResult(renderPayload(input, found, text, budget), budget);
        }

        if (action === "read_symbol") {
          const read = service.readSymbol(query, {
            file: input.file,
            kind: input.kind,
            limit: input.limit ?? 10,
            includeImports: input.includeImports,
          });
          const text = read.status === "ok"
            ? read.text ?? ""
            : read.status === "ambiguous"
              ? renderAmbiguous(query, read.matches, read.freshness)
              : `ctx_code read_symbol: ${query}\n${renderFreshness(read.freshness)}\nnot found`;
          return textResult(renderPayload(input, read, text, budget), budget, read.status === "not-found");
        }

        if (action === "refs_light") {
          const refs = service.refsLight(query, { file: input.file, limit: input.limit ?? 40 });
          return textResult(renderPayload(input, refs, renderRefsLight(query, refs), budget), budget);
        }

        if (action === "related_files" || action === "likely_tests") {
          if (!input.file) return errorResult(`CTX_CODE_FILE_REQUIRED: ${action} requires file.`);
          const related = service.relatedFiles(input.file, { testLimit: input.limit ?? 8 });
          const text = action === "likely_tests"
            ? renderLikelyTests(related)
            : renderRelatedFiles(related);
          return textResult(renderPayload(input, related, text, budget), budget);
        }

        const read = query
          ? service.readSymbol(query, {
            file: input.file,
            kind: input.kind,
            limit: input.limit ?? 10,
            includeImports: true,
          })
          : undefined;
        const packFile = input.file ?? (read?.status === "ok" ? read.matches[0]?.filePath : undefined);
        if (read?.status === "ambiguous") {
          const text = renderAmbiguous(query, read.matches, read.freshness);
          return textResult(renderPayload(input, read, text, budget), budget);
        }
        if (!packFile) return errorResult("CTX_CODE_PACK_TARGET_REQUIRED: pack requires file, query, or symbol.");
        const outline = service.fileOutline(packFile);
        const related = service.relatedFiles(packFile);
        const refs = query ? service.refsLight(query, { file: packFile, limit: Math.min(input.limit ?? 12, 20) }) : undefined;
        const text = renderContextPack(query || packFile, packFile, read, outline.symbols, related, refs);
        return textResult(renderPayload(input, { read, outline, related, refs }, text, budget), budget);
      } catch (err) {
        return { content: [{ type: "text", text: formatReadPolicyError(err) }], isError: true };
      } finally {
        try { store?.close(); } catch { /* ignore */ }
      }
    },
  };
}

function resolveCodeProjectDir(input: CodeInput, deps: CodeDeps): string {
  return input.projectDir?.trim()
    ? deps.resolveProjectDirOverride?.(input.projectDir) ?? resolve(input.projectDir)
    : deps.getProjectDir();
}

function defaultBudget(action: NonNullable<CodeInput["action"]>): number {
  if (action === "pack") return 8 * 1024;
  if (action === "read_symbol") return 6 * 1024;
  if (action === "refs_light") return 6 * 1024;
  if (action === "related_files") return 5 * 1024;
  if (action === "likely_tests") return 2 * 1024;
  if (action === "file_outline") return 4 * 1024;
  return 3 * 1024;
}

function renderPayload(input: CodeInput, payload: unknown, text: string, budgetBytes = Number.POSITIVE_INFINITY): string {
  if (!input.json) return text;
  const raw = JSON.stringify(payload, null, 2);
  if (!Number.isFinite(budgetBytes) || Buffer.byteLength(raw) <= budgetBytes) return raw;
  return budgetedJson(raw, budgetBytes);
}

function textResult(text: string, budgetBytes: number, isError = false): ToolTextResult {
  return {
    content: [{ type: "text", text: truncateUtf8(text, budgetBytes) }],
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }], isError: true };
}

function truncateUtf8(text: string, budgetBytes: number): string {
  const bytes = Buffer.byteLength(text);
  if (bytes <= budgetBytes) return text;
  const marker = `\n... omitted ${bytes - budgetBytes} bytes by ctx_code budget`;
  return Buffer.from(text).subarray(0, Math.max(0, budgetBytes - Buffer.byteLength(marker))).toString("utf8").replace(/\uFFFD$/, "") + marker;
}

function budgetedJson(raw: string, budgetBytes: number): string {
  const actualBytes = Buffer.byteLength(raw);
  let previewBytes = Math.max(0, budgetBytes - 180);
  while (previewBytes >= 0) {
    const preview = truncateUtf8(raw, previewBytes);
    const encoded = JSON.stringify({
      truncated: true,
      budgetBytes,
      actualBytes,
      preview,
    }, null, 2);
    if (Buffer.byteLength(encoded) <= budgetBytes || previewBytes === 0) return encoded;
    previewBytes = Math.max(0, previewBytes - 128);
  }
  return JSON.stringify({ truncated: true, budgetBytes, actualBytes });
}

function renderFreshness(freshness: CodeIndexFreshness): string {
  return `freshness: checked ${freshness.checked}, reused ${freshness.reused}, parsed ${freshness.parsed}, denied ${freshness.denied}, skipped ${freshness.skipped}`;
}

function renderFindSymbols(
  query: string,
  matches: readonly CodeIndexMatch[],
  freshness: CodeIndexFreshness,
  limit: number,
  compact: boolean,
): string {
  if (compact) {
    const lines = [
      `ctx_code find_symbol ${query}`,
      `freshness: c${freshness.checked} r${freshness.reused} p${freshness.parsed} d${freshness.denied} s${freshness.skipped}`,
      ...matches.slice(0, limit).map((match) =>
        `${match.confidence.toUpperCase()} ${match.filePath}:${match.startLine}-${match.endLine} ${match.kind} ${match.qualifiedName} ${match.exportStatus}`
      ),
    ];
    if (matches.length === 0) lines.push("not found");
    if (matches.length > limit) lines.push(`omitted: ${matches.length - limit}`);
    return lines.join("\n");
  }
  const lines = [
    `ctx_code find_symbol: ${query}`,
    "provider: code-index",
    renderFreshness(freshness),
    "",
  ];
  if (matches.length === 0) lines.push("not found");
  for (const match of matches.slice(0, limit)) lines.push(renderSymbolLine(match));
  if (matches.length > limit) lines.push(`omitted: ${matches.length - limit}`);
  return lines.join("\n");
}

function renderAmbiguous(query: string, matches: readonly CodeIndexMatch[], freshness: CodeIndexFreshness): string {
  return [
    `ctx_code read_symbol: ${query}`,
    "ambiguous: pass file to narrow the match",
    renderFreshness(freshness),
    "",
    ...matches.slice(0, 12).map(renderSymbolLine),
    matches.length > 12 ? `omitted: ${matches.length - 12}` : "",
  ].filter(Boolean).join("\n");
}

function renderFileOutline(
  filePath: string,
  symbols: readonly CodeSymbolRecord[],
  freshness: CodeIndexFreshness,
  compact: boolean,
  limit: number,
): string {
  if (compact) {
    const grouped = new Map<string, string[]>();
    for (const symbol of symbols) {
      if (symbol.kind === "import") continue;
      const label = `${symbol.qualifiedName}@${symbol.startLine}`;
      const bucket = grouped.get(symbol.kind) ?? [];
      if (bucket.length < Math.max(1, limit)) bucket.push(label);
      grouped.set(symbol.kind, bucket);
    }
    const lines = [
      `ctx_code file_outline ${filePath}`,
      `symbols: ${symbols.length}`,
      `freshness: c${freshness.checked} r${freshness.reused} p${freshness.parsed} d${freshness.denied} s${freshness.skipped}`,
      "",
    ];
    for (const [kind, names] of grouped) lines.push(`${kind}: ${names.join(", ")}`);
    if (symbols.length === 0) lines.push("(no symbols found)");
    return lines.join("\n");
  }
  const lines = [
    `ctx_code file_outline: ${filePath}`,
    "provider: code-index",
    renderFreshness(freshness),
    "",
  ];
  for (const symbol of symbols.slice(0, limit)) {
    lines.push(compact ? renderCompactSymbolLine(symbol) : renderSymbolLine(symbol));
  }
  if (symbols.length > limit) lines.push(`omitted: ${symbols.length - limit}`);
  if (symbols.length === 0) lines.push("(no symbols found)");
  return lines.join("\n");
}

function renderRefsLight(query: string, refs: {
  readonly freshness: CodeIndexFreshness;
  readonly definition?: CodeIndexMatch;
  readonly matches: readonly { filePath: string; line: number; snippet: string; confidence: string; reason: string }[];
  readonly omitted: number;
}): string {
  const lines = [
    `ctx_code refs_light: ${query}`,
    "provider: textual+code-index confidence=low",
    renderFreshness(refs.freshness),
    refs.definition ? `definition: ${refs.definition.filePath}:${refs.definition.startLine}-${refs.definition.endLine} ${refs.definition.kind} ${refs.definition.qualifiedName}` : "definition: not found",
    "",
  ];
  for (const match of refs.matches) {
    lines.push(`${match.confidence.toUpperCase()} ${match.filePath}:${match.line} ${match.reason}: ${match.snippet}`);
  }
  if (refs.omitted > 0) lines.push(`omitted: ${refs.omitted}`);
  if (refs.matches.length === 0) lines.push("(no textual refs found)");
  return lines.join("\n");
}

function renderRelatedFiles(related: RelatedFilesResult): string {
  const importedByOmitted = Math.max(0, related.importers.length - 20);
  const lines = [
    `ctx_code related_files: ${related.filePath}`,
    "provider: code-index import-graph confidence=medium",
    renderFreshness(related.freshness),
    "",
    "imports:",
  ];
  for (const imp of related.imports.slice(0, 20)) {
    lines.push(`- ${imp.localName ?? imp.importedName ?? "*"} from ${imp.source} @${imp.line}`);
  }
  if (related.imports.length > 20) lines.push(`- omitted: ${related.imports.length - 20}`);
  if (related.imports.length === 0) lines.push("- none");

  lines.push("", "resolved_imports:");
  for (const imported of related.importedFiles.slice(0, 20)) lines.push(`- ${imported}`);
  if (related.importedFiles.length > 20) lines.push(`- omitted: ${related.importedFiles.length - 20}`);
  if (related.importedFiles.length === 0) lines.push("- none");

  lines.push("", "imported_by:");
  for (const importer of related.importers.slice(0, 20)) lines.push(`- ${importer.filePath}:${importer.line} via ${importer.source}`);
  if (importedByOmitted > 0) lines.push(`- omitted: ${importedByOmitted}`);
  if (related.importers.length === 0) lines.push("- none");

  lines.push("", "likely_tests:");
  for (const test of related.likelyTests) lines.push(`- ${test}`);
  if (related.likelyTests.length === 0) lines.push("- none");
  return lines.join("\n");
}

function renderLikelyTests(related: RelatedFilesResult): string {
  const lines = [
    `ctx_code likely_tests: ${related.filePath}`,
    "provider: code-index path/import heuristic confidence=medium",
    renderFreshness(related.freshness),
    "",
  ];
  for (const test of related.likelyTests) lines.push(`- ${test}`);
  if (related.likelyTests.length === 0) lines.push("- none");
  return lines.join("\n");
}

function renderContextPack(
  label: string,
  filePath: string,
  read: ReadSymbolResult | undefined,
  symbols: readonly CodeSymbolRecord[],
  related: RelatedFilesResult,
  refs: RefLightResult | undefined,
): string {
  const lines = [
    `ctx_code pack: ${label}`,
    `target: ${filePath}`,
    "provider: code-index static-pack confidence=medium",
    renderFreshness(related.freshness),
    "",
    "outline:",
  ];
  for (const symbol of symbols.slice(0, 20)) {
    lines.push(`- ${symbol.kind} ${symbol.qualifiedName}@${symbol.startLine}-${symbol.endLine} ${symbol.exportStatus}`);
  }
  if (symbols.length > 20) lines.push(`- omitted: ${symbols.length - 20}`);
  if (symbols.length === 0) lines.push("- none");

  if (read?.status === "ok" && read.text) {
    lines.push("", "symbol_slice:", trimSection(read.text, 2400));
  } else if (read?.status === "ambiguous") {
    lines.push("", "symbol_slice: ambiguous; pass file/kind to narrow");
  } else if (read?.status === "not-found") {
    lines.push("", "symbol_slice: not found");
  }

  lines.push("", "imports:");
  for (const imp of related.imports.slice(0, 12)) {
    lines.push(`- ${imp.localName ?? imp.importedName ?? "*"} from ${imp.source} @${imp.line}`);
  }
  if (related.imports.length > 12) lines.push(`- omitted: ${related.imports.length - 12}`);
  if (related.imports.length === 0) lines.push("- none");

  lines.push("", "related_files:");
  for (const imported of related.importedFiles.slice(0, 10)) lines.push(`- imports ${imported}`);
  for (const importer of related.importers.slice(0, 10)) lines.push(`- imported by ${importer.filePath}:${importer.line}`);
  if (related.importedFiles.length === 0 && related.importers.length === 0) lines.push("- none");

  lines.push("", "likely_tests:");
  for (const test of related.likelyTests) lines.push(`- ${test}`);
  if (related.likelyTests.length === 0) lines.push("- none");

  if (refs) {
    lines.push("", "refs_light:");
    if (refs.definition) lines.push(`- definition ${refs.definition.filePath}:${refs.definition.startLine}-${refs.definition.endLine}`);
    for (const match of refs.matches.slice(0, 12)) lines.push(`- ${match.confidence} ${match.filePath}:${match.line} ${match.snippet}`);
    if (refs.omitted > 0) lines.push(`- omitted: ${refs.omitted}`);
    if (refs.matches.length === 0) lines.push("- none");
  }

  return lines.join("\n");
}

function renderSymbolLine(match: CodeSymbolRecord): string {
  return `${match.confidence.toUpperCase()} ${match.filePath}:${match.startLine}-${match.endLine} ${match.kind} ${match.qualifiedName} ${match.exportStatus}${match.signaturePreview ? ` — ${match.signaturePreview}` : ""}`;
}

function renderCompactSymbolLine(match: CodeSymbolRecord): string {
  return `${match.filePath}:${match.startLine}-${match.endLine} ${match.kind} ${match.qualifiedName}`;
}

function trimSection(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const marker = "\n... omitted by ctx_code pack section budget";
  return Buffer.from(text).subarray(0, Math.max(0, maxBytes - Buffer.byteLength(marker))).toString("utf8").replace(/\uFFFD$/, "") + marker;
}
