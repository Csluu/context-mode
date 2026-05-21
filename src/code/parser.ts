import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import type {
  CodeExportRecord,
  CodeHeadingRecord,
  CodeImportRecord,
  CodeIndexConfidence,
  CodeSymbolRecord,
  ParsedCodeFile,
} from "./types.js";

export const CODE_INDEX_SCHEMA_VERSION = 1;
export const TYPESCRIPT_STATIC_PARSER_VERSION = "typescript-static-v1";
export const RUST_STATIC_PARSER_VERSION = "rust-static-v1";
const require = createRequire(import.meta.url);

export function languageForCodePath(filePath: string): string | null {
  if (/\.tsx$/i.test(filePath)) return "tsx";
  if (/\.ts$/i.test(filePath) || /\.mts$/i.test(filePath) || /\.cts$/i.test(filePath)) return "ts";
  if (/\.jsx$/i.test(filePath)) return "jsx";
  if (/\.js$/i.test(filePath) || /\.mjs$/i.test(filePath) || /\.cjs$/i.test(filePath)) return "js";
  if (/\.rs$/i.test(filePath)) return "rust";
  if (/\.mdx?$/i.test(filePath)) return "markdown";
  return null;
}

export function supportedCodePath(filePath: string): boolean {
  return languageForCodePath(filePath) !== null;
}

export function parserIdentityForCodePath(filePath: string): { parser: string; parserVersion: string } | null {
  const language = languageForCodePath(filePath);
  if (language === "markdown") return { parser: "markdown-heading", parserVersion: "markdown-heading-v1" };
  if (language === "rust") return { parser: "rust-static", parserVersion: RUST_STATIC_PARSER_VERSION };
  if (language && ["ts", "tsx", "js", "jsx"].includes(language)) {
    return loadTypeScriptModule()
      ? { parser: "typescript-compiler", parserVersion: TYPESCRIPT_STATIC_PARSER_VERSION }
      : { parser: "heuristic", parserVersion: "heuristic-v1" };
  }
  return null;
}

function loadTypeScriptModule(): any | null {
  try {
    const moduleName = "typescript";
    return require(moduleName);
  } catch {
    return null;
  }
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function limitText(text: string, max = 180): string {
  const compact = compactWhitespace(text);
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function rangeHash(lines: readonly string[], startLine: number, endLine: number): string {
  return createHash("sha256")
    .update(lines.slice(startLine - 1, endLine).join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function symbolId(filePath: string, qualifiedName: string, kind: string, startLine: number, ordinal: number): string {
  return createHash("sha256")
    .update([filePath, qualifiedName, kind, startLine, ordinal].join("\0"))
    .digest("hex")
    .slice(0, 20);
}

function makeParsedBase(input: {
  relPath: string;
  realPath: string;
  language: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string;
  parser: string;
  parserVersion: string;
  indexedAt: string;
  symbols?: readonly CodeSymbolRecord[];
  imports?: readonly CodeImportRecord[];
  exports?: readonly CodeExportRecord[];
  headings?: readonly CodeHeadingRecord[];
}): ParsedCodeFile {
  return {
    path: input.relPath,
    realPath: input.realPath,
    language: input.language,
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs,
    contentHash: input.contentHash,
    parser: input.parser,
    parserVersion: input.parserVersion,
    schemaVersion: CODE_INDEX_SCHEMA_VERSION,
    indexedAt: input.indexedAt,
    symbols: input.symbols ?? [],
    imports: input.imports ?? [],
    exports: input.exports ?? [],
    headings: input.headings ?? [],
  };
}

export function parseCodeFile(input: {
  readonly relPath: string;
  readonly realPath: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly indexedAt?: string;
}): ParsedCodeFile {
  const language = languageForCodePath(input.realPath) ?? "text";
  const indexedAt = input.indexedAt ?? new Date().toISOString();
  if (language === "markdown") {
    return parseMarkdownFile({ ...input, language, indexedAt });
  }
  if (["ts", "tsx", "js", "jsx"].includes(language)) {
    const ts = loadTypeScriptModule();
    if (ts) return parseTypeScriptLikeFile({ ...input, language, indexedAt, ts });
  }
  if (language === "rust") {
    return parseRustFile({ ...input, language, indexedAt });
  }
  return parseHeuristicFile({ ...input, language, indexedAt });
}

function parseMarkdownFile(input: {
  readonly relPath: string;
  readonly realPath: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly language: string;
  readonly indexedAt: string;
}): ParsedCodeFile {
  const headings: CodeHeadingRecord[] = [];
  const symbols: CodeSymbolRecord[] = [];
  const lines = input.content.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    const lineNo = i + 1;
    headings.push({ filePath: input.relPath, line: lineNo, level: match[1].length, text });
    symbols.push({
      filePath: input.relPath,
      symbolId: symbolId(input.relPath, text, "heading", lineNo, i),
      qualifiedName: text,
      name: text,
      kind: "heading",
      parentSymbolId: null,
      ordinal: i,
      startLine: lineNo,
      endLine: lineNo,
      startCol: 1,
      endCol: line.length + 1,
      rangeHash: rangeHash(lines, lineNo, lineNo),
      signaturePreview: line.trim(),
      exportStatus: "local",
      confidence: "high",
      parser: "markdown-heading",
    });
  }
  return makeParsedBase({
    ...input,
    parser: "markdown-heading",
    parserVersion: "markdown-heading-v1",
    symbols,
    headings,
  });
}

function parseHeuristicFile(input: {
  readonly relPath: string;
  readonly realPath: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly language: string;
  readonly indexedAt: string;
}): ParsedCodeFile {
  const lines = input.content.split(/\r?\n/);
  const symbols: CodeSymbolRecord[] = [];
  let ordinal = 0;
  for (const [i, line] of lines.entries()) {
    const match =
      /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line) ??
      /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line) ??
      /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(line) ??
      /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/.exec(line) ??
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!match) continue;
    const lineNo = i + 1;
    const name = match[1];
    symbols.push({
      filePath: input.relPath,
      symbolId: symbolId(input.relPath, name, "symbol", lineNo, ordinal),
      qualifiedName: name,
      name,
      kind: "symbol",
      parentSymbolId: null,
      ordinal: ordinal++,
      startLine: lineNo,
      endLine: lineNo,
      startCol: 1,
      endCol: line.length + 1,
      rangeHash: rangeHash(lines, lineNo, lineNo),
      signaturePreview: limitText(line),
      exportStatus: /^\s*export\s+/.test(line) ? "exported" : "local",
      confidence: "low",
      parser: "heuristic",
    });
  }
  return makeParsedBase({
    ...input,
    parser: "heuristic",
    parserVersion: "heuristic-v1",
    symbols,
  });
}

function parseRustFile(input: {
  readonly relPath: string;
  readonly realPath: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly language: string;
  readonly indexedAt: string;
}): ParsedCodeFile {
  const lines = input.content.split(/\r?\n/);
  const symbols: CodeSymbolRecord[] = [];
  const imports: CodeImportRecord[] = [];
  let ordinal = 0;
  let activeImpl: { qualifiedName: string; symbolId: string; braceDepth: number; hasOpened: boolean } | null = null;

  function pushLineSymbol(line: string, lineNo: number, kind: string, name: string, endLine: number, qualifiedName = name): CodeSymbolRecord {
    const symbol: CodeSymbolRecord = {
      filePath: input.relPath,
      symbolId: symbolId(input.relPath, qualifiedName, kind, lineNo, ordinal),
      qualifiedName,
      name,
      kind,
      parentSymbolId: activeImpl?.symbolId ?? null,
      ordinal: ordinal++,
      startLine: lineNo,
      endLine,
      startCol: Math.max(1, line.indexOf(name) + 1),
      endCol: Math.max(1, line.indexOf(name) + name.length + 1),
      rangeHash: rangeHash(lines, lineNo, endLine),
      signaturePreview: limitText(line),
      exportStatus: /^\s*pub(?:\(|\s)/.test(line) ? "exported" : "local",
      confidence: "medium",
      parser: "rust-static",
    };
    symbols.push(symbol);
    return symbol;
  }

  function blockEnd(startIndex: number): number {
    let depth = 0;
    let sawBrace = false;
    for (let i = startIndex; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === "{") {
          sawBrace = true;
          depth++;
        } else if (char === "}") {
          depth--;
        }
      }
      if (sawBrace && depth <= 0) return i + 1;
    }
    return startIndex + 1;
  }

  function braceDelta(line: string): number {
    let delta = 0;
    for (const char of line) {
      if (char === "{") delta++;
      else if (char === "}") delta--;
    }
    return delta;
  }

  for (const [i, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    const lineNo = i + 1;
    if (!line || line.startsWith("//")) continue;

    if (activeImpl) {
      const method = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?fn\s+([A-Za-z_][\w]*)\b/.exec(line);
      if (method) {
        pushLineSymbol(rawLine, lineNo, "method", method[1], blockEnd(i), `${activeImpl.qualifiedName}.${method[1]}`);
      }
      activeImpl.braceDepth += braceDelta(rawLine);
      if (rawLine.includes("{")) activeImpl.hasOpened = true;
      if (activeImpl.hasOpened && activeImpl.braceDepth <= 0) activeImpl = null;
      continue;
    }

    const moduleDecl = /^(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][\w]*)\s*;/.exec(line);
    if (moduleDecl) {
      imports.push({
        filePath: input.relPath,
        source: `./${moduleDecl[1]}`,
        importedName: moduleDecl[1],
        localName: moduleDecl[1],
        line: lineNo,
        kind: "rust-mod",
        confidence: "medium",
      });
      continue;
    }

    const declaration =
      /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?fn\s+([A-Za-z_][\w]*)\b/.exec(line) ??
      /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][\w]*)\b/.exec(line) ??
      /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][\w]*)\b/.exec(line) ??
      /^(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][\w]*)\b/.exec(line) ??
      /^(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_][\w]*)\b/.exec(line);
    if (declaration) {
      const kind = /\bfn\s+/.test(line)
        ? "function"
        : /\bstruct\s+/.test(line)
          ? "struct"
          : /\benum\s+/.test(line)
            ? "enum"
            : /\btrait\s+/.test(line)
              ? "trait"
              : "type";
      pushLineSymbol(rawLine, lineNo, kind, declaration[1], blockEnd(i));
      continue;
    }

    const impl = /^impl(?:\s*<[^>]+>)?(?:\s+[A-Za-z_][\w:<>]*\s+for)?\s+([A-Za-z_][\w:<>]*)\s*\{?/.exec(line);
    if (impl) {
      const target = impl[1].replace(/<.*$/, "");
      const symbol = pushLineSymbol(rawLine, lineNo, "impl", target, blockEnd(i), `impl ${target}`);
      activeImpl = {
        qualifiedName: target,
        symbolId: symbol.symbolId,
        braceDepth: braceDelta(rawLine),
        hasOpened: rawLine.includes("{"),
      };
      if (activeImpl.hasOpened && activeImpl.braceDepth <= 0) activeImpl = null;
    }
  }

  return makeParsedBase({
    ...input,
    parser: "rust-static",
    parserVersion: RUST_STATIC_PARSER_VERSION,
    symbols,
    imports,
  });
}

function parseTypeScriptLikeFile(input: {
  readonly relPath: string;
  readonly realPath: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly language: string;
  readonly indexedAt: string;
  readonly ts: any;
}): ParsedCodeFile {
  const ts = input.ts;
  const scriptKind = input.language === "tsx"
    ? ts.ScriptKind.TSX
    : input.language === "jsx"
      ? ts.ScriptKind.JSX
      : input.language === "js"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(input.realPath, input.content, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = input.content.split(/\r?\n/);
  const symbols: CodeSymbolRecord[] = [];
  const imports: CodeImportRecord[] = [];
  const exports: CodeExportRecord[] = [];
  let ordinal = 0;

  function positionRange(node: any): { startLine: number; endLine: number; startCol: number; endCol: number } {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      startLine: start.line + 1,
      endLine: end.line + 1,
      startCol: start.character + 1,
      endCol: end.character + 1,
    };
  }

  function sourceLine(node: any, max = 180): string {
    const rawLines = String(node.getText(sourceFile)).split(/\r?\n/);
    const declarationLine = rawLines.find((line) => !line.trim().startsWith("@")) ?? rawLines[0] ?? "";
    return limitText(declarationLine, max);
  }

  function nodeName(node: any): string | undefined {
    const name = node?.name;
    if (!name) return undefined;
    return limitText(name.getText(sourceFile), 100);
  }

  function modifierFlags(node: any): { exported: boolean; defaulted: boolean } {
    const modifiers = Array.from(node?.modifiers ?? []) as Array<{ kind?: number }>;
    return {
      exported: modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      defaulted: modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
    };
  }

  function exportStatus(node: any): "local" | "exported" | "default" {
    const flags = modifierFlags(node);
    if (flags.defaulted) return "default";
    if (flags.exported) return "exported";
    return "local";
  }

  function variableKeyword(node: any): "const" | "let" | "var" {
    const flags = node?.declarationList?.flags ?? 0;
    if ((flags & ts.NodeFlags.Const) !== 0) return "const";
    if ((flags & ts.NodeFlags.Let) !== 0) return "let";
    return "var";
  }

  function addExport(symbol: CodeSymbolRecord, localName?: string | null): void {
    if (symbol.exportStatus === "local") return;
    exports.push({
      filePath: input.relPath,
      exportedName: symbol.exportStatus === "default" ? "default" : symbol.name,
      localName: localName ?? symbol.name,
      symbolId: symbol.symbolId,
      line: symbol.startLine,
      kind: symbol.kind,
      confidence: symbol.confidence,
    });
  }

  function pushSymbol(
    node: any,
    kind: string,
    options: {
      name?: string;
      qualifiedName?: string;
      parentSymbolId?: string | null;
      signature?: string;
      exportStatus?: "local" | "exported" | "default";
      confidence?: CodeIndexConfidence;
    } = {},
  ): CodeSymbolRecord | null {
    const name = options.name ?? nodeName(node);
    if (!name) return null;
    const range = positionRange(node);
    const qualifiedName = options.qualifiedName ?? name;
    const id = symbolId(input.relPath, qualifiedName, kind, range.startLine, ordinal);
    const symbol: CodeSymbolRecord = {
      filePath: input.relPath,
      symbolId: id,
      qualifiedName,
      name,
      kind,
      parentSymbolId: options.parentSymbolId ?? null,
      ordinal: ordinal++,
      startLine: range.startLine,
      endLine: range.endLine,
      startCol: range.startCol,
      endCol: range.endCol,
      rangeHash: rangeHash(lines, range.startLine, range.endLine),
      signaturePreview: options.signature ?? sourceLine(node),
      exportStatus: options.exportStatus ?? exportStatus(node),
      confidence: options.confidence ?? "high",
      parser: "typescript-compiler",
    };
    symbols.push(symbol);
    addExport(symbol);
    return symbol;
  }

  function importSource(node: any): string | null {
    const specifier = node?.moduleSpecifier;
    return typeof specifier?.text === "string" ? specifier.text : null;
  }

  function pushImportRows(node: any): void {
    const source = importSource(node);
    if (!source) return;
    const line = positionRange(node).startLine;
    const clause = node.importClause;
    if (!clause) {
      imports.push({ filePath: input.relPath, source, importedName: null, localName: null, line, kind: "side-effect", confidence: "high" });
      return;
    }
    if (clause.name) {
      imports.push({ filePath: input.relPath, source, importedName: "default", localName: clause.name.getText(sourceFile), line, kind: "default", confidence: "high" });
    }
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      imports.push({ filePath: input.relPath, source, importedName: "*", localName: named.name.getText(sourceFile), line, kind: "namespace", confidence: "high" });
    } else if (named && ts.isNamedImports(named)) {
      for (const element of Array.from(named.elements ?? []) as any[]) {
        imports.push({
          filePath: input.relPath,
          source,
          importedName: element.propertyName?.getText(sourceFile) ?? element.name?.getText(sourceFile) ?? null,
          localName: element.name?.getText(sourceFile) ?? null,
          line,
          kind: "named",
          confidence: "high",
        });
      }
    }
  }

  function pushExportDeclarationRows(node: any): void {
    const line = positionRange(node).startLine;
    const source = importSource(node);
    const clause = node.exportClause;
    if (source) {
      imports.push({
        filePath: input.relPath,
        source,
        importedName: null,
        localName: null,
        line,
        kind: "re-export",
        confidence: "high",
      });
    }
    if (clause && ts.isNamedExports(clause)) {
      for (const element of Array.from(clause.elements ?? []) as any[]) {
        const exportedName = element.name?.getText(sourceFile);
        if (!exportedName) continue;
        exports.push({
          filePath: input.relPath,
          exportedName,
          localName: element.propertyName?.getText(sourceFile) ?? exportedName,
          symbolId: null,
          line,
          kind: source ? "re-export" : "export",
          confidence: "high",
        });
      }
    } else {
      exports.push({
        filePath: input.relPath,
        exportedName: source ? "*" : "unknown",
        localName: null,
        symbolId: null,
        line,
        kind: source ? "re-export" : "export",
        confidence: "medium",
      });
    }
  }

  function pushVariableDeclarations(node: any, parentQualifiedName?: string, parentSymbolId?: string | null): void {
    const keyword = variableKeyword(node);
    const status = exportStatus(node);
    for (const declaration of Array.from(node.declarationList?.declarations ?? []) as any[]) {
      const name = limitText(declaration.name?.getText(sourceFile) ?? "", 100);
      if (!name) continue;
      const initializer = declaration.initializer;
      const isFunctionLike = initializer
        && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
      const kind = isFunctionLike ? "function" : "binding";
      pushSymbol(declaration, kind, {
        name,
        qualifiedName: parentQualifiedName ? `${parentQualifiedName}.${name}` : name,
        parentSymbolId,
        signature: `${status === "default" ? "export default " : status === "exported" ? "export " : ""}${keyword} ${name}`,
        exportStatus: status,
      });
    }
  }

  function visit(node: any, parentQualifiedName?: string, parentSymbolId?: string | null): void {
    if (ts.isImportDeclaration(node)) {
      pushImportRows(node);
    } else if (ts.isFunctionDeclaration(node)) {
      pushSymbol(node, "function");
    } else if (ts.isClassDeclaration(node)) {
      const symbol = pushSymbol(node, "class");
      if (symbol) {
        ts.forEachChild(node, (child: any) => visit(child, symbol.qualifiedName, symbol.symbolId));
        return;
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(node, "interface");
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(node, "type");
    } else if (ts.isEnumDeclaration(node)) {
      pushSymbol(node, "enum");
    } else if (ts.isModuleDeclaration(node)) {
      const symbol = pushSymbol(node, "module");
      if (symbol) {
        ts.forEachChild(node, (child: any) => visit(child, symbol.qualifiedName, symbol.symbolId));
        return;
      }
    } else if (ts.isVariableStatement(node)) {
      pushVariableDeclarations(node, parentQualifiedName, parentSymbolId);
    } else if (ts.isMethodDeclaration(node)) {
      const name = nodeName(node);
      pushSymbol(node, "method", {
        name,
        qualifiedName: parentQualifiedName && name ? `${parentQualifiedName}.${name}` : name,
        parentSymbolId,
        exportStatus: "local",
      });
    } else if (ts.isConstructorDeclaration(node)) {
      pushSymbol(node, "method", {
        name: "constructor",
        qualifiedName: parentQualifiedName ? `${parentQualifiedName}.constructor` : "constructor",
        parentSymbolId,
        signature: sourceLine(node),
        exportStatus: "local",
      });
    } else if (ts.isPropertyDeclaration(node)) {
      const name = nodeName(node);
      pushSymbol(node, "property", {
        name,
        qualifiedName: parentQualifiedName && name ? `${parentQualifiedName}.${name}` : name,
        parentSymbolId,
        exportStatus: "local",
      });
    } else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const name = nodeName(node);
      pushSymbol(node, "accessor", {
        name,
        qualifiedName: parentQualifiedName && name ? `${parentQualifiedName}.${name}` : name,
        parentSymbolId,
        exportStatus: "local",
      });
    } else if (ts.isExportDeclaration(node)) {
      pushExportDeclarationRows(node);
    } else if (ts.isExportAssignment(node)) {
      const line = positionRange(node).startLine;
      exports.push({ filePath: input.relPath, exportedName: "default", localName: null, symbolId: null, line, kind: "default", confidence: "medium" });
    }

    if (ts.isSourceFile(node) || ts.isModuleBlock(node)) {
      ts.forEachChild(node, (child: any) => visit(child, parentQualifiedName, parentSymbolId));
    }
  }

  visit(sourceFile);
  return makeParsedBase({
    ...input,
    parser: "typescript-compiler",
    parserVersion: TYPESCRIPT_STATIC_PARSER_VERSION,
    symbols,
    imports,
    exports,
  });
}
