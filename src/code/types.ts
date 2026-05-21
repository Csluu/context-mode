export type CodeIndexConfidence = "high" | "medium" | "low";

export interface CodeFileRecord {
  readonly projectKey: string;
  readonly path: string;
  readonly realPath: string;
  readonly language: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly parser: string;
  readonly parserVersion: string;
  readonly schemaVersion: number;
  readonly indexedAt: string;
}

export interface CodeSymbolRecord {
  readonly projectKey?: string;
  readonly filePath: string;
  readonly symbolId: string;
  readonly qualifiedName: string;
  readonly name: string;
  readonly kind: string;
  readonly parentSymbolId?: string | null;
  readonly ordinal: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startCol?: number | null;
  readonly endCol?: number | null;
  readonly rangeHash?: string | null;
  readonly signaturePreview?: string | null;
  readonly exportStatus: "local" | "exported" | "default";
  readonly confidence: CodeIndexConfidence;
  readonly parser: string;
}

export interface CodeImportRecord {
  readonly filePath: string;
  readonly source: string;
  readonly importedName?: string | null;
  readonly localName?: string | null;
  readonly line: number;
  readonly kind: string;
  readonly confidence: CodeIndexConfidence;
}

export interface CodeExportRecord {
  readonly filePath: string;
  readonly exportedName: string;
  readonly localName?: string | null;
  readonly symbolId?: string | null;
  readonly line: number;
  readonly kind: string;
  readonly confidence: CodeIndexConfidence;
}

export interface CodeHeadingRecord {
  readonly filePath: string;
  readonly line: number;
  readonly level: number;
  readonly text: string;
}

export interface ParsedCodeFile {
  readonly path: string;
  readonly realPath: string;
  readonly language: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly parser: string;
  readonly parserVersion: string;
  readonly schemaVersion: number;
  readonly indexedAt: string;
  readonly symbols: readonly CodeSymbolRecord[];
  readonly imports: readonly CodeImportRecord[];
  readonly exports: readonly CodeExportRecord[];
  readonly headings: readonly CodeHeadingRecord[];
}

export interface CodeIndexFreshness {
  readonly checked: number;
  readonly reused: number;
  readonly parsed: number;
  readonly denied: number;
  readonly skipped: number;
}

export interface CodeIndexMatch extends CodeSymbolRecord {
  readonly file?: CodeFileRecord;
}
