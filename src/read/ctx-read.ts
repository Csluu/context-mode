import { createHash } from "node:crypto";
import { existsSync, realpathSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export type CtxReadMode = "auto" | "map" | "outline" | "slice" | "symbols" | "full";
export type CtxReadProviderConfidence = "low" | "medium" | "high";

export interface CtxReadInput {
  readonly projectDir: string;
  readonly path: string;
  readonly mode?: CtxReadMode;
  readonly compact?: boolean;
  readonly start?: number;
  readonly end?: number;
  readonly reason?: string;
}

export interface CtxReadResult {
  readonly path: string;
  readonly mode: CtxReadMode;
  readonly provider: string;
  readonly providerConfidence?: CtxReadProviderConfidence;
  readonly lineCount: number;
  readonly bytes: number;
  readonly hash?: string;
  readonly unchangedSinceLastRead?: boolean;
  readonly text: string;
  readonly truncated?: boolean;
}

export interface CodeMapSymbol {
  readonly line: number;
  readonly kind: string;
  readonly text: string;
  readonly name?: string;
  readonly detail?: string;
}

export interface CodeMapProvider {
  readonly name: "heuristic" | "tree-sitter" | "typescript-lsp" | "serena" | string;
  readonly confidence: CtxReadProviderConfidence;
  supports(filePath: string, lines: readonly string[]): boolean;
  getSymbols(filePath: string, lines: readonly string[]): readonly CodeMapSymbol[];
}

const SMALL_FILE_LINES = 500;
const MEDIUM_FILE_LINES = 2_000;
const MAX_SLICE_LINES = 400;
const require = createRequire(import.meta.url);
const readCache = new Map<string, {
  hash: string;
  lineCount: number;
  bytes: number;
  provider: string;
  providerConfidence?: CtxReadProviderConfidence;
}>();
const SENSITIVE_PATH_RE = /(^|[\\/])(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials|config|known_hosts|authorized_keys|.*\.(?:pem|key|p12|pfx|crt))$/i;
const SENSITIVE_DIR_RE = /(^|[\\/])(?:\.ssh|\.aws|\.azure|\.gnupg|\.kube)([\\/]|$)/i;

function assertInside(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel))) return;
  throw new Error(`file path escapes project root: ${target}`);
}

export function resolveReadPath(projectDir: string, requestedPath: string): string {
  const root = resolve(projectDir);
  const target = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath);
  assertInside(root, target);
  const realRoot = realpathSync(root);
  const realTarget = existsSync(target) ? realpathSync(target) : target;
  assertInside(realRoot, realTarget);
  return realTarget;
}

function resolveRequestedPathForPolicy(projectDir: string, requestedPath: string): string {
  const root = resolve(projectDir);
  return isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath);
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.2;
}

function binaryKind(buffer: Buffer, filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 6).equals(Buffer.from("GIF87a")) || buffer.subarray(0, 6).equals(Buffer.from("GIF89a"))) return "image/gif";
  if (buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) return "application/gzip";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "application/zip";
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "ico"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  if (["gz", "tgz"].includes(ext)) return "application/gzip";
  if (["zip", "jar"].includes(ext)) return "application/zip";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function binaryMagic(buffer: Buffer): string {
  return buffer.subarray(0, Math.min(16, buffer.length)).toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
}

function renderBinaryStub(filePath: string, buffer: Buffer): string {
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  return [
    `binary: ${binaryKind(buffer, filePath)}`,
    `bytes: ${buffer.length}`,
    `hash16: ${hash}`,
    `magic: ${binaryMagic(buffer) || "(empty)"}`,
    "content omitted; use an explicit binary-aware tool if byte-level inspection is required",
  ].join("\n");
}

function assertNotSensitivePath(filePath: string): void {
  if (SENSITIVE_DIR_RE.test(filePath) || SENSITIVE_PATH_RE.test(filePath)) {
    throw new Error(`sensitive file blocked: ${filePath}`);
  }
}

function numbered(lines: readonly string[], startLine: number): string {
  return lines.map((line, i) => `${String(startLine + i).padStart(5)}: ${line}`).join("\n");
}

function numberedCompact(lines: readonly string[], startLine: number): string {
  return lines.map((line, i) => `${startLine + i}: ${line}`).join("\n");
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function limitText(text: string, max = 180): string {
  const compact = compactWhitespace(text);
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function symbolKind(line: string): string | null {
  if (/^\s{0,3}#{1,6}\s+\S/.test(line)) return "heading";
  if (/^\s*import\b/.test(line)) return "import";
  if (/^\s*from\s+\S+\s+import\b/.test(line)) return "import";
  if (/^\s*(export\s+)?(async\s+)?function\s+\w+/.test(line)) return "function";
  if (/^\s*(async\s+)?def\s+\w+\s*\(/.test(line)) return "function";
  if (/^\s*(export\s+)?class\s+\w+/.test(line)) return "class";
  if (/^\s*(export\s+)?interface\s+\w+/.test(line)) return "interface";
  if (/^\s*(export\s+)?type\s+\w+/.test(line)) return "type";
  if (/^\s*(export\s+)?(?:const|let|var)\s+\w+\s*=/.test(line)) return "binding";
  if (/^\s*export\s+/.test(line)) return "export";
  if (/^\s*(public|private|protected)?\s*(async\s+)?\w+\([^)]*\)\s*[:{]/.test(line)) return "method";
  if (/^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?fn\s+\w+\b/.test(line)) return "function";
  if (/^\s*(pub(?:\([^)]*\))?\s+)?struct\s+\w+\b/.test(line)) return "struct";
  if (/^\s*(pub(?:\([^)]*\))?\s+)?enum\s+\w+\b/.test(line)) return "enum";
  if (/^\s*(pub(?:\([^)]*\))?\s+)?trait\s+\w+\b/.test(line)) return "trait";
  if (/^\s*(pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*;/.test(line)) return "module";
  if (/^\s*impl(?:\s*<[^>]+>)?(?:\s+\w[\w:<>]*\s+for)?\s+\w[\w:<>]*\s*\{?/.test(line)) return "impl";
  return null;
}

function renderDirectoryMap(dirPath: string): string {
  const entries = readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  const maxEntries = 120;
  const rows = entries.slice(0, maxEntries).map((entry) => {
    const marker = entry.isDirectory() ? "[dir] " : "[file]";
    let detail = "";
    if (!entry.isDirectory()) {
      try {
        detail = ` ${statSync(resolve(dirPath, entry.name)).size}B`;
      } catch { /* best effort */ }
    }
    return `- ${marker} ${entry.name}${entry.isDirectory() ? "/" : detail}`;
  });
  if (entries.length > maxEntries) {
    rows.push(`... ${entries.length - maxEntries} more entries omitted`);
  }
  return [
    `Directory map: ${dirPath}`,
    `entries: ${entries.length}`,
    "",
    ...rows,
  ].join("\n");
}

function collectSymbols(lines: readonly string[]): CodeMapSymbol[] {
  const symbols: CodeMapSymbol[] = [];
  for (const [i, line] of lines.entries()) {
    const kind = symbolKind(line);
    if (!kind) continue;
    symbols.push({ line: i + 1, kind, text: line.trim().slice(0, 180) });
  }
  return symbols;
}

export const HEURISTIC_CODE_MAP_PROVIDER: CodeMapProvider = {
  name: "heuristic",
  confidence: "low",
  supports: () => true,
  getSymbols: (_filePath, lines) => collectSymbols(lines),
};

function loadTypeScriptModule(): any | null {
  try {
    const moduleName = "typescript";
    return require(moduleName);
  } catch {
    return null;
  }
}

export const TYPESCRIPT_CODE_MAP_PROVIDER: CodeMapProvider = {
  name: "typescript-compiler",
  confidence: "high",
  supports(filePath) {
    if (!/\.[cm]?[jt]sx?$/i.test(filePath)) return false;
    return loadTypeScriptModule() !== null;
  },
  getSymbols(filePath, lines) {
    const ts = loadTypeScriptModule();
    if (!ts) return [];
    const content = lines.join("\n");
    const scriptKind = filePath.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : filePath.endsWith(".jsx")
        ? ts.ScriptKind.JSX
        : filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const symbols: CodeMapSymbol[] = [];

    function sourceLine(node: any, max = 160): string {
      const rawLines = String(node.getText(sourceFile)).split(/\r?\n/);
      const declarationLine = rawLines.find((line) => !line.trim().startsWith("@")) ?? rawLines[0] ?? "";
      return limitText(declarationLine, max);
    }

    function nodeName(node: any): string | undefined {
      const name = node?.name;
      if (!name) return undefined;
      return limitText(name.getText(sourceFile), 80);
    }

    function moduleDetail(node: any): string | undefined {
      const specifier = node?.moduleSpecifier;
      return typeof specifier?.text === "string" ? `"${specifier.text}"` : undefined;
    }

    function modifierPrefix(node: any): string {
      const modifiers = Array.from(node?.modifiers ?? []) as Array<{ kind?: number }>;
      const hasExport = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const hasDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      if (hasExport && hasDefault) return "export default ";
      if (hasExport) return "export ";
      return "";
    }

    function variableKeyword(node: any): "const" | "let" | "var" {
      const flags = node?.declarationList?.flags ?? 0;
      if ((flags & ts.NodeFlags.Const) !== 0) return "const";
      if ((flags & ts.NodeFlags.Let) !== 0) return "let";
      return "var";
    }

    function push(node: any, kind: string, options: { name?: string; detail?: string; text?: string } = {}): void {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const text = options.text ?? sourceLine(node);
      symbols.push({ line, kind, text, name: options.name, detail: options.detail });
    }

    function pushVariableDeclarations(node: any): void {
      const keyword = variableKeyword(node);
      const prefix = `${modifierPrefix(node)}${keyword}`;
      for (const declaration of Array.from(node.declarationList?.declarations ?? []) as any[]) {
        const name = limitText(declaration.name?.getText(sourceFile) ?? "", 80);
        const initializer = declaration.initializer;
        const isFunctionLike = initializer
          && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
        const kind = isFunctionLike ? "function" : "binding";
        push(declaration, kind, {
          name,
          detail: prefix,
          text: name ? `${prefix} ${name}` : sourceLine(declaration),
        });
      }
    }

    function visit(node: any): void {
      if (ts.isImportDeclaration(node)) {
        const detail = moduleDetail(node);
        push(node, "import", { name: detail, detail, text: sourceLine(node) });
      } else if (ts.isFunctionDeclaration(node)) {
        push(node, "function", { name: nodeName(node), detail: modifierPrefix(node).trim() || undefined });
      } else if (ts.isClassDeclaration(node)) {
        push(node, "class", { name: nodeName(node), detail: modifierPrefix(node).trim() || undefined });
      } else if (ts.isInterfaceDeclaration(node)) {
        push(node, "interface", { name: nodeName(node), detail: modifierPrefix(node).trim() || undefined });
      } else if (ts.isTypeAliasDeclaration(node)) {
        push(node, "type", { name: nodeName(node), detail: modifierPrefix(node).trim() || undefined });
      } else if (ts.isEnumDeclaration(node)) {
        push(node, "enum", { name: nodeName(node), detail: modifierPrefix(node).trim() || undefined });
      } else if (ts.isModuleDeclaration(node)) {
        push(node, "module", { name: nodeName(node), detail: modifierPrefix(node).trim() || undefined });
      } else if (ts.isVariableStatement(node)) {
        pushVariableDeclarations(node);
      } else if (ts.isMethodDeclaration(node)) {
        push(node, "method", { name: nodeName(node) });
      } else if (ts.isConstructorDeclaration(node)) {
        push(node, "method", { name: "constructor", text: sourceLine(node) });
      } else if (ts.isPropertyDeclaration(node)) {
        push(node, "property", { name: nodeName(node) });
      } else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        push(node, "accessor", { name: nodeName(node) });
      } else if (ts.isExportDeclaration(node)) {
        const detail = moduleDetail(node);
        push(node, "export", { name: detail, detail, text: sourceLine(node) });
      } else if (ts.isExportAssignment(node)) {
        push(node, "export", { name: "default", text: sourceLine(node) });
      }

      if (ts.isSourceFile(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) {
        ts.forEachChild(node, visit);
      }
    }

    visit(sourceFile);
    return symbols;
  },
};

function chooseProviderResult(
  filePath: string,
  lines: readonly string[],
  providers: readonly CodeMapProvider[] = [TYPESCRIPT_CODE_MAP_PROVIDER, HEURISTIC_CODE_MAP_PROVIDER],
): { provider: CodeMapProvider; symbols: readonly CodeMapSymbol[] } {
  for (const provider of providers) {
    if (!provider.supports(filePath, lines)) continue;
    try {
      return { provider, symbols: provider.getSymbols(filePath, lines) };
    } catch {
      // Provider failures must not block ctx_read. Try the next lower-fidelity provider.
    }
  }
  return { provider: HEURISTIC_CODE_MAP_PROVIDER, symbols: HEURISTIC_CODE_MAP_PROVIDER.getSymbols(filePath, lines) };
}

function renderSymbols(symbols: readonly CodeMapSymbol[], limit = 120): string {
  if (symbols.length === 0) return "(no symbols found)";
  const shown = symbols.slice(0, limit).map((s) => `${String(s.line).padStart(5)} ${s.kind.padEnd(9)} ${s.text}`);
  if (symbols.length > limit) shown.push(`... ${symbols.length - limit} more symbols omitted`);
  return shown.join("\n");
}

function renderCompactSymbols(symbols: readonly CodeMapSymbol[], limit = 80): string {
  if (symbols.length === 0) return "(no symbols found)";
  const shown = symbols.slice(0, limit).map((symbol) => {
    const label = limitText([
      symbol.name || symbol.text,
      symbol.detail ? `(${symbol.detail})` : "",
    ].filter(Boolean).join(" "), 120);
    return `L${String(symbol.line).padStart(5, "0")} ${symbol.kind} ${label}`;
  });
  if (symbols.length > limit) shown.push(`... ${symbols.length - limit} more symbols omitted`);
  return shown.join("\n");
}

function renderProviderMetadata(provider: CodeMapProvider): string {
  return `provider: ${provider.name} confidence=${provider.confidence}`;
}

function renderMap(
  filePath: string,
  lines: readonly string[],
  bytes: number,
  symbols: readonly CodeMapSymbol[],
  provider: CodeMapProvider,
  compact: boolean,
): string {
  const importCount = symbols.filter((s) => s.kind === "import").length;
  const exportCount = symbols.filter((s) => s.kind === "export").length;
  if (compact) {
    const suggested = symbols
      .filter((s) => !["import", "export"].includes(s.kind))
      .slice(0, 10)
      .map((s) => `L${String(Math.max(1, s.line - 3)).padStart(5, "0")}-${String(Math.min(lines.length, s.line + 30)).padStart(5, "0")} ${s.name || s.text}`);
    return [
      "map compact",
      renderProviderMetadata(provider),
      `lines: ${lines.length} bytes: ${bytes} imports: ${importCount} exports: ${exportCount} symbols: ${symbols.length}`,
      "",
      renderCompactSymbols(symbols, 60),
      "",
      "slices:",
      ...(suggested.length > 0 ? suggested : ["none"]),
    ].join("\n");
  }
  const suggested = symbols
    .filter((s) => !["import", "export"].includes(s.kind))
    .slice(0, 20)
    .map((s) => `- lines ${Math.max(1, s.line - 3)}-${Math.min(lines.length, s.line + 30)}: ${s.text}`);
  return [
    `File map: ${filePath}`,
    `name: ${basename(filePath)}`,
    `lines: ${lines.length}`,
    `bytes: ${bytes}`,
    `provider: ${provider.name}`,
    `imports: ${importCount}`,
    `exports: ${exportCount}`,
    `symbols: ${symbols.length}`,
    "",
    "Symbols:",
    renderSymbols(symbols, 80),
    "",
    "Suggested slices:",
    ...(suggested.length > 0 ? suggested : ["- no symbol slices found"]),
  ].join("\n");
}

function renderOutline(
  filePath: string,
  lines: readonly string[],
  bytes: number,
  symbols: readonly CodeMapSymbol[],
  provider: CodeMapProvider,
  compact: boolean,
): string {
  if (compact) {
    return [
      "outline compact",
      renderProviderMetadata(provider),
      `lines: ${lines.length} bytes: ${bytes} symbols: ${symbols.length}`,
      "",
      renderCompactSymbols(symbols, 100),
    ].join("\n");
  }
  return [
    `Outline: ${filePath}`,
    `lines: ${lines.length}`,
    `bytes: ${bytes}`,
    `provider: ${provider.name}`,
    "",
    renderSymbols(symbols, 160),
  ].join("\n");
}

function renderSymbolsResult(symbols: readonly CodeMapSymbol[], provider: CodeMapProvider, compact: boolean): string {
  if (!compact) return renderSymbols(symbols);
  return [
    "symbols compact",
    renderProviderMetadata(provider),
    `symbols: ${symbols.length}`,
    "",
    renderCompactSymbols(symbols, 100),
  ].join("\n");
}

function chooseMode(mode: CtxReadMode | undefined, lineCount: number): CtxReadMode {
  if (mode && mode !== "auto") return mode;
  if (lineCount <= SMALL_FILE_LINES) return "full";
  if (lineCount <= MEDIUM_FILE_LINES) return "outline";
  return "map";
}

export function ctxRead(input: CtxReadInput): CtxReadResult {
  assertNotSensitivePath(resolveRequestedPathForPolicy(input.projectDir, input.path));
  const filePath = resolveReadPath(input.projectDir, input.path);
  assertNotSensitivePath(filePath);
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const stats = statSync(filePath);
  if (stats.isDirectory()) {
    return {
      path: filePath,
      mode: input.mode && input.mode !== "auto" ? input.mode : "map",
      provider: "directory",
      providerConfidence: "high",
      lineCount: 0,
      bytes: 0,
      text: renderDirectoryMap(filePath),
    };
  }
  if (!stats.isFile()) throw new Error(`not a file: ${filePath}`);
  const buffer = readFileSync(filePath);
  if (looksBinary(buffer)) {
    return {
      path: filePath,
      mode: input.mode && input.mode !== "auto" ? input.mode : "auto",
      provider: "binary-stub",
      providerConfidence: "high",
      lineCount: 0,
      bytes: buffer.length,
      hash: createHash("sha256").update(buffer).digest("hex"),
      text: renderBinaryStub(filePath, buffer),
    };
  }

  const content = buffer.toString("utf8");
  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const mode = chooseMode(input.mode, lineCount);
  const compact = input.compact === true && ["map", "outline", "symbols", "slice"].includes(mode);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const { provider, symbols } = chooseProviderResult(filePath, lines);

  if (mode === "full" && lineCount > SMALL_FILE_LINES && !input.reason?.trim()) {
    throw new Error(`full read requires reason for files over ${SMALL_FILE_LINES} lines`);
  }

  const cacheKey = [
    filePath,
    mode,
    compact ? "compact" : "full",
    provider.name,
    provider.confidence,
    input.start ?? "",
    input.end ?? "",
  ].join("\0");
  const cacheable = mode !== "slice" && lineCount > SMALL_FILE_LINES;
  const previous = readCache.get(cacheKey);
  if (cacheable && previous?.hash === hash) {
    return {
      path: filePath,
      mode,
      provider: provider.name,
      providerConfidence: provider.confidence,
      lineCount,
      bytes: buffer.length,
      hash,
      unchangedSinceLastRead: true,
      text: [
        "unchanged since last read",
        `hash: ${hash}`,
        `lines: ${lineCount}`,
        `bytes: ${buffer.length}`,
        `previous provider: ${previous.provider} confidence=${previous.providerConfidence ?? "unknown"}`,
      ].join("\n"),
    };
  }

  if (mode === "full") {
    if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name, providerConfidence: provider.confidence });
    return {
      path: filePath,
      mode,
      provider: provider.name,
      providerConfidence: provider.confidence,
      lineCount,
      bytes: buffer.length,
      hash,
      text: numbered(lines, 1),
    };
  }

  if (mode === "slice") {
    const start = Math.max(1, input.start ?? 1);
    const end = Math.min(lineCount, input.end ?? start + 120);
    if (end < start) throw new Error("slice end must be >= start");
    const cappedEnd = Math.min(end, start + MAX_SLICE_LINES - 1);
    return {
      path: filePath,
      mode,
      provider: provider.name,
      providerConfidence: provider.confidence,
      lineCount,
      bytes: buffer.length,
      hash,
      text: compact ? numberedCompact(lines.slice(start - 1, cappedEnd), start) : numbered(lines.slice(start - 1, cappedEnd), start),
      truncated: cappedEnd < end,
    };
  }

  if (mode === "symbols") {
    if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name, providerConfidence: provider.confidence });
    return {
      path: filePath,
      mode,
      provider: provider.name,
      providerConfidence: provider.confidence,
      lineCount,
      bytes: buffer.length,
      hash,
      text: renderSymbolsResult(symbols, provider, compact),
    };
  }

  if (mode === "outline") {
    if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name, providerConfidence: provider.confidence });
    return {
      path: filePath,
      mode,
      provider: provider.name,
      providerConfidence: provider.confidence,
      lineCount,
      bytes: buffer.length,
      hash,
      text: renderOutline(filePath, lines, buffer.length, symbols, provider, compact),
    };
  }

  if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name, providerConfidence: provider.confidence });
  return {
    path: filePath,
    mode,
    provider: provider.name,
    providerConfidence: provider.confidence,
    lineCount,
    bytes: buffer.length,
    hash,
    text: renderMap(filePath, lines, buffer.length, symbols, provider, compact),
  };
}
