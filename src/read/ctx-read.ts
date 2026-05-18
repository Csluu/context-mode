import { createHash } from "node:crypto";
import { existsSync, realpathSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export type CtxReadMode = "auto" | "map" | "outline" | "slice" | "symbols" | "full";

export interface CtxReadInput {
  readonly projectDir: string;
  readonly path: string;
  readonly mode?: CtxReadMode;
  readonly start?: number;
  readonly end?: number;
  readonly reason?: string;
}

export interface CtxReadResult {
  readonly path: string;
  readonly mode: CtxReadMode;
  readonly provider: string;
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
}

export interface CodeMapProvider {
  readonly name: "heuristic" | "tree-sitter" | "typescript-lsp" | "serena" | string;
  supports(filePath: string, lines: readonly string[]): boolean;
  getSymbols(filePath: string, lines: readonly string[]): readonly CodeMapSymbol[];
}

const SMALL_FILE_LINES = 500;
const MEDIUM_FILE_LINES = 2_000;
const MAX_SLICE_LINES = 400;
const require = createRequire(import.meta.url);
const readCache = new Map<string, { hash: string; lineCount: number; bytes: number; provider: string }>();
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

function assertNotSensitivePath(filePath: string): void {
  if (SENSITIVE_DIR_RE.test(filePath) || SENSITIVE_PATH_RE.test(filePath)) {
    throw new Error(`sensitive file blocked: ${filePath}`);
  }
}

function numbered(lines: readonly string[], startLine: number): string {
  return lines.map((line, i) => `${String(startLine + i).padStart(5)}: ${line}`).join("\n");
}

function symbolKind(line: string): string | null {
  if (/^\s{0,3}#{1,6}\s+\S/.test(line)) return "heading";
  if (/^\s*import\b/.test(line)) return "import";
  if (/^\s*(export\s+)?(async\s+)?function\s+\w+/.test(line)) return "function";
  if (/^\s*(export\s+)?class\s+\w+/.test(line)) return "class";
  if (/^\s*(export\s+)?interface\s+\w+/.test(line)) return "interface";
  if (/^\s*(export\s+)?type\s+\w+/.test(line)) return "type";
  if (/^\s*(export\s+)?(?:const|let|var)\s+\w+\s*=/.test(line)) return "binding";
  if (/^\s*export\s+/.test(line)) return "export";
  if (/^\s*(public|private|protected)?\s*(async\s+)?\w+\([^)]*\)\s*[:{]/.test(line)) return "method";
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

    function push(node: any, kind: string): void {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const text = node.getText(sourceFile).split(/\r?\n/, 1)[0]?.trim().slice(0, 180) ?? "";
      symbols.push({ line, kind, text });
    }

    function visit(node: any): void {
      if (ts.isImportDeclaration(node)) push(node, "import");
      else if (ts.isFunctionDeclaration(node)) push(node, "function");
      else if (ts.isClassDeclaration(node)) push(node, "class");
      else if (ts.isInterfaceDeclaration(node)) push(node, "interface");
      else if (ts.isTypeAliasDeclaration(node)) push(node, "type");
      else if (ts.isVariableStatement(node)) push(node, "binding");
      else if (ts.isMethodDeclaration(node)) push(node, "method");
      else if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) push(node, "export");

      if (ts.isSourceFile(node) || ts.isClassDeclaration(node)) {
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
  if (symbols.length === 0) return "(no symbols found by heuristic parser)";
  const shown = symbols.slice(0, limit).map((s) => `${String(s.line).padStart(5)} ${s.kind.padEnd(9)} ${s.text}`);
  if (symbols.length > limit) shown.push(`... ${symbols.length - limit} more symbols omitted`);
  return shown.join("\n");
}

function renderMap(filePath: string, lines: readonly string[], bytes: number, symbols: readonly CodeMapSymbol[], provider: CodeMapProvider): string {
  const importCount = symbols.filter((s) => s.kind === "import").length;
  const exportCount = symbols.filter((s) => s.kind === "export").length;
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

function renderOutline(filePath: string, lines: readonly string[], bytes: number, symbols: readonly CodeMapSymbol[], provider: CodeMapProvider): string {
  return [
    `Outline: ${filePath}`,
    `lines: ${lines.length}`,
    `bytes: ${bytes}`,
    `provider: ${provider.name}`,
    "",
    renderSymbols(symbols, 160),
  ].join("\n");
}

function chooseMode(mode: CtxReadMode | undefined, lineCount: number): CtxReadMode {
  if (mode && mode !== "auto") return mode;
  if (lineCount <= SMALL_FILE_LINES) return "full";
  if (lineCount <= MEDIUM_FILE_LINES) return "outline";
  return "map";
}

export function ctxRead(input: CtxReadInput): CtxReadResult {
  const filePath = resolveReadPath(input.projectDir, input.path);
  assertNotSensitivePath(filePath);
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const stats = statSync(filePath);
  if (stats.isDirectory()) {
    return {
      path: filePath,
      mode: input.mode && input.mode !== "auto" ? input.mode : "map",
      provider: "directory",
      lineCount: 0,
      bytes: 0,
      text: renderDirectoryMap(filePath),
    };
  }
  if (!stats.isFile()) throw new Error(`not a file: ${filePath}`);
  const buffer = readFileSync(filePath);
  if (looksBinary(buffer)) throw new Error(`binary file blocked: ${filePath}`);

  const content = buffer.toString("utf8");
  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const mode = chooseMode(input.mode, lineCount);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const { provider, symbols } = chooseProviderResult(filePath, lines);

  if (mode === "full" && lineCount > SMALL_FILE_LINES && !input.reason?.trim()) {
    throw new Error(`full read requires reason for files over ${SMALL_FILE_LINES} lines`);
  }

  const cacheKey = `${filePath}\0${mode}\0${input.start ?? ""}\0${input.end ?? ""}`;
  const cacheable = mode !== "slice" && lineCount > SMALL_FILE_LINES;
  const previous = readCache.get(cacheKey);
  if (cacheable && previous?.hash === hash) {
    return {
      path: filePath,
      mode,
      provider: provider.name,
      lineCount,
      bytes: buffer.length,
      hash,
      unchangedSinceLastRead: true,
      text: [
        "unchanged since last read",
        `hash: ${hash}`,
        `lines: ${lineCount}`,
        `bytes: ${buffer.length}`,
        `previous provider: ${previous.provider}`,
      ].join("\n"),
    };
  }

  if (mode === "full") {
    if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name });
    return {
      path: filePath,
      mode,
      provider: provider.name,
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
      lineCount,
      bytes: buffer.length,
      hash,
      text: numbered(lines.slice(start - 1, cappedEnd), start),
      truncated: cappedEnd < end,
    };
  }

  if (mode === "symbols") {
    if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name });
    return {
      path: filePath,
      mode,
      provider: provider.name,
      lineCount,
      bytes: buffer.length,
      hash,
      text: renderSymbols(symbols),
    };
  }

  if (mode === "outline") {
    if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name });
    return {
      path: filePath,
      mode,
      provider: provider.name,
      lineCount,
      bytes: buffer.length,
      hash,
      text: renderOutline(filePath, lines, buffer.length, symbols, provider),
    };
  }

  if (cacheable) readCache.set(cacheKey, { hash, lineCount, bytes: buffer.length, provider: provider.name });
  return {
    path: filePath,
    mode,
    provider: provider.name,
    lineCount,
    bytes: buffer.length,
    hash,
    text: renderMap(filePath, lines, buffer.length, symbols, provider),
  };
}
