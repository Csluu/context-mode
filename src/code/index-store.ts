import type { PreparedStatement } from "../db-base.js";
import { SQLiteBase } from "../db-base.js";
import type {
  CodeFileRecord,
  CodeHeadingRecord,
  CodeImportRecord,
  CodeIndexMatch,
  CodeSymbolRecord,
  ParsedCodeFile,
} from "./types.js";

export class CodeIndexStore extends SQLiteBase {
  private declare stmtGetFile: PreparedStatement;
  private declare stmtListFilePaths: PreparedStatement;
  private declare stmtUpsertMeta: PreparedStatement;
  private declare stmtUpsertFile: PreparedStatement;
  private declare stmtMarkFileDeleted: PreparedStatement;
  private declare stmtDeleteSymbols: PreparedStatement;
  private declare stmtDeleteImports: PreparedStatement;
  private declare stmtDeleteExports: PreparedStatement;
  private declare stmtDeleteHeadings: PreparedStatement;
  private declare stmtInsertSymbol: PreparedStatement;
  private declare stmtInsertImport: PreparedStatement;
  private declare stmtInsertExport: PreparedStatement;
  private declare stmtInsertHeading: PreparedStatement;
  private declare stmtFindSymbols: PreparedStatement;
  private declare stmtSymbolsForFile: PreparedStatement;
  private declare stmtSymbolById: PreparedStatement;
  private declare stmtImportsForFile: PreparedStatement;
  private declare stmtImportsForProject: PreparedStatement;
  private declare stmtImportersForSource: PreparedStatement;
  private declare stmtRecordDenial: PreparedStatement;

  protected initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS code_index_meta (
        project_key TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        last_indexed_at TEXT,
        last_gc_at TEXT
      );

      CREATE TABLE IF NOT EXISTS code_files (
        project_key TEXT NOT NULL,
        path TEXT NOT NULL,
        real_path TEXT NOT NULL,
        language TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        content_hash TEXT NOT NULL,
        parser TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        config_hash TEXT,
        ignore_hash TEXT,
        indexed_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (project_key, path)
      );

      CREATE TABLE IF NOT EXISTS code_denials (
        project_key TEXT NOT NULL,
        path TEXT NOT NULL,
        real_path_hint TEXT,
        policy_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        denied_at TEXT NOT NULL,
        PRIMARY KEY (project_key, path, policy_hash)
      );

      CREATE TABLE IF NOT EXISTS code_symbols (
        project_key TEXT NOT NULL,
        file_path TEXT NOT NULL,
        symbol_id TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        parent_symbol_id TEXT,
        ordinal INTEGER NOT NULL DEFAULT 0,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_col INTEGER,
        end_col INTEGER,
        range_hash TEXT,
        signature_preview TEXT,
        export_status TEXT NOT NULL DEFAULT 'local',
        confidence TEXT NOT NULL,
        parser TEXT NOT NULL,
        PRIMARY KEY (project_key, file_path, symbol_id)
      );

      CREATE TABLE IF NOT EXISTS code_imports (
        project_key TEXT NOT NULL,
        file_path TEXT NOT NULL,
        source TEXT NOT NULL,
        imported_name TEXT,
        local_name TEXT,
        line INTEGER NOT NULL,
        kind TEXT NOT NULL,
        confidence TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS code_exports (
        project_key TEXT NOT NULL,
        file_path TEXT NOT NULL,
        exported_name TEXT NOT NULL,
        local_name TEXT,
        symbol_id TEXT,
        line INTEGER NOT NULL,
        kind TEXT NOT NULL,
        confidence TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS code_headings (
        project_key TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        level INTEGER NOT NULL,
        text TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(project_key, name);
      CREATE INDEX IF NOT EXISTS idx_code_symbols_qualified ON code_symbols(project_key, qualified_name);
      CREATE INDEX IF NOT EXISTS idx_code_symbols_file ON code_symbols(project_key, file_path);
      CREATE INDEX IF NOT EXISTS idx_code_imports_file ON code_imports(project_key, file_path);
      CREATE INDEX IF NOT EXISTS idx_code_imports_source ON code_imports(project_key, source);
      CREATE INDEX IF NOT EXISTS idx_code_exports_file ON code_exports(project_key, file_path);
      CREATE INDEX IF NOT EXISTS idx_code_exports_name ON code_exports(project_key, exported_name);
      CREATE INDEX IF NOT EXISTS idx_code_headings_file ON code_headings(project_key, file_path);
      CREATE INDEX IF NOT EXISTS idx_code_denials_project ON code_denials(project_key, path);
    `);
  }

  protected prepareStatements(): void {
    this.stmtGetFile = this.db.prepare(`
      SELECT project_key AS projectKey, path, real_path AS realPath, language,
             size_bytes AS sizeBytes, mtime_ms AS mtimeMs, content_hash AS contentHash,
             parser, parser_version AS parserVersion, schema_version AS schemaVersion,
             indexed_at AS indexedAt
      FROM code_files
      WHERE project_key = ? AND path = ? AND deleted_at IS NULL
    `) as PreparedStatement;
    this.stmtListFilePaths = this.db.prepare(`
      SELECT path
      FROM code_files
      WHERE project_key = ? AND deleted_at IS NULL
      ORDER BY path ASC
    `) as PreparedStatement;
    this.stmtUpsertMeta = this.db.prepare(`
      INSERT INTO code_index_meta(project_key, root_path, schema_version, last_indexed_at, last_gc_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(project_key) DO UPDATE SET
        root_path = excluded.root_path,
        schema_version = excluded.schema_version,
        last_indexed_at = excluded.last_indexed_at
    `) as PreparedStatement;
    this.stmtUpsertFile = this.db.prepare(`
      INSERT INTO code_files(project_key, path, real_path, language, size_bytes, mtime_ms, content_hash, parser, parser_version, schema_version, config_hash, ignore_hash, indexed_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)
      ON CONFLICT(project_key, path) DO UPDATE SET
        real_path = excluded.real_path,
        language = excluded.language,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        content_hash = excluded.content_hash,
        parser = excluded.parser,
        parser_version = excluded.parser_version,
        schema_version = excluded.schema_version,
        indexed_at = excluded.indexed_at,
        deleted_at = NULL
    `) as PreparedStatement;
    this.stmtMarkFileDeleted = this.db.prepare(`
      UPDATE code_files
      SET deleted_at = ?
      WHERE project_key = ? AND path = ? AND deleted_at IS NULL
    `) as PreparedStatement;
    this.stmtDeleteSymbols = this.db.prepare("DELETE FROM code_symbols WHERE project_key = ? AND file_path = ?") as PreparedStatement;
    this.stmtDeleteImports = this.db.prepare("DELETE FROM code_imports WHERE project_key = ? AND file_path = ?") as PreparedStatement;
    this.stmtDeleteExports = this.db.prepare("DELETE FROM code_exports WHERE project_key = ? AND file_path = ?") as PreparedStatement;
    this.stmtDeleteHeadings = this.db.prepare("DELETE FROM code_headings WHERE project_key = ? AND file_path = ?") as PreparedStatement;
    this.stmtInsertSymbol = this.db.prepare(`
      INSERT INTO code_symbols(project_key, file_path, symbol_id, qualified_name, name, kind, parent_symbol_id, ordinal, start_line, end_line, start_col, end_col, range_hash, signature_preview, export_status, confidence, parser)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `) as PreparedStatement;
    this.stmtInsertImport = this.db.prepare(`
      INSERT INTO code_imports(project_key, file_path, source, imported_name, local_name, line, kind, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `) as PreparedStatement;
    this.stmtInsertExport = this.db.prepare(`
      INSERT INTO code_exports(project_key, file_path, exported_name, local_name, symbol_id, line, kind, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `) as PreparedStatement;
    this.stmtInsertHeading = this.db.prepare(`
      INSERT INTO code_headings(project_key, file_path, line, level, text)
      VALUES (?, ?, ?, ?, ?)
    `) as PreparedStatement;
    this.stmtFindSymbols = this.db.prepare(`
      SELECT s.project_key AS projectKey, s.file_path AS filePath, s.symbol_id AS symbolId,
             s.qualified_name AS qualifiedName, s.name, s.kind,
             s.parent_symbol_id AS parentSymbolId, s.ordinal,
             s.start_line AS startLine, s.end_line AS endLine,
             s.start_col AS startCol, s.end_col AS endCol, s.range_hash AS rangeHash,
             s.signature_preview AS signaturePreview, s.export_status AS exportStatus,
             s.confidence, s.parser,
             f.project_key AS fileProjectKey, f.path AS filePathRecord, f.real_path AS fileRealPath,
             f.language AS fileLanguage, f.size_bytes AS fileSizeBytes, f.mtime_ms AS fileMtimeMs,
             f.content_hash AS fileContentHash, f.parser AS fileParser,
             f.parser_version AS fileParserVersion, f.schema_version AS fileSchemaVersion,
             f.indexed_at AS fileIndexedAt
      FROM code_symbols s
      JOIN code_files f ON f.project_key = s.project_key AND f.path = s.file_path
      WHERE s.project_key = ?
        AND f.deleted_at IS NULL
        AND (? IS NULL OR s.kind = ?)
        AND (? IS NULL OR s.file_path = ?)
        AND (
          s.name = ?
          OR s.qualified_name = ?
          OR s.name LIKE ?
          OR s.qualified_name LIKE ?
        )
      ORDER BY
        CASE
          WHEN s.name = ? THEN 0
          WHEN s.qualified_name = ? THEN 1
          WHEN s.name LIKE ? THEN 2
          ELSE 3
        END,
        s.file_path ASC,
        s.start_line ASC
      LIMIT ?
    `) as PreparedStatement;
    this.stmtSymbolsForFile = this.db.prepare(`
      SELECT project_key AS projectKey, file_path AS filePath, symbol_id AS symbolId,
             qualified_name AS qualifiedName, name, kind, parent_symbol_id AS parentSymbolId,
             ordinal, start_line AS startLine, end_line AS endLine, start_col AS startCol,
             end_col AS endCol, range_hash AS rangeHash, signature_preview AS signaturePreview,
             export_status AS exportStatus, confidence, parser
      FROM code_symbols
      WHERE project_key = ? AND file_path = ?
      ORDER BY start_line ASC, ordinal ASC
    `) as PreparedStatement;
    this.stmtSymbolById = this.db.prepare(`
      SELECT project_key AS projectKey, file_path AS filePath, symbol_id AS symbolId,
             qualified_name AS qualifiedName, name, kind, parent_symbol_id AS parentSymbolId,
             ordinal, start_line AS startLine, end_line AS endLine, start_col AS startCol,
             end_col AS endCol, range_hash AS rangeHash, signature_preview AS signaturePreview,
             export_status AS exportStatus, confidence, parser
      FROM code_symbols
      WHERE project_key = ? AND file_path = ? AND symbol_id = ?
    `) as PreparedStatement;
    this.stmtImportsForFile = this.db.prepare(`
      SELECT file_path AS filePath, source, imported_name AS importedName, local_name AS localName, line, kind, confidence
      FROM code_imports
      WHERE project_key = ? AND file_path = ?
      ORDER BY line ASC
    `) as PreparedStatement;
    this.stmtImportsForProject = this.db.prepare(`
      SELECT i.file_path AS filePath, i.source, i.imported_name AS importedName, i.local_name AS localName, i.line, i.kind, i.confidence
      FROM code_imports i
      JOIN code_files f ON f.project_key = i.project_key AND f.path = i.file_path
      WHERE i.project_key = ? AND f.deleted_at IS NULL
      ORDER BY i.file_path ASC, i.line ASC
    `) as PreparedStatement;
    this.stmtImportersForSource = this.db.prepare(`
      SELECT file_path AS filePath, source, imported_name AS importedName, local_name AS localName, line, kind, confidence
      FROM code_imports
      WHERE project_key = ? AND source = ?
      ORDER BY file_path ASC, line ASC
    `) as PreparedStatement;
    this.stmtRecordDenial = this.db.prepare(`
      INSERT INTO code_denials(project_key, path, real_path_hint, policy_hash, reason, denied_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_key, path, policy_hash) DO UPDATE SET
        real_path_hint = excluded.real_path_hint,
        reason = excluded.reason,
        denied_at = excluded.denied_at
    `) as PreparedStatement;
  }

  upsertProjectMeta(projectKey: string, rootPath: string, schemaVersion: number): void {
    this.withRetry(() => this.stmtUpsertMeta.run(projectKey, rootPath, schemaVersion, new Date().toISOString()));
  }

  getFile(projectKey: string, filePath: string): CodeFileRecord | null {
    return (this.stmtGetFile.get(projectKey, filePath) as CodeFileRecord | undefined) ?? null;
  }

  listFilePaths(projectKey: string): string[] {
    const rows = this.stmtListFilePaths.all(projectKey) as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  markFileDeleted(projectKey: string, filePath: string): void {
    this.withRetry(() => {
      const tx = (this.db as any).transaction(() => {
        this.stmtMarkFileDeleted.run(new Date().toISOString(), projectKey, filePath);
        this.stmtDeleteSymbols.run(projectKey, filePath);
        this.stmtDeleteImports.run(projectKey, filePath);
        this.stmtDeleteExports.run(projectKey, filePath);
        this.stmtDeleteHeadings.run(projectKey, filePath);
      });
      tx();
    });
  }

  replaceFileFacts(projectKey: string, facts: ParsedCodeFile): void {
    this.withRetry(() => {
      const tx = (this.db as any).transaction(() => {
        this.stmtUpsertFile.run(
          projectKey,
          facts.path,
          facts.realPath,
          facts.language,
          facts.sizeBytes,
          facts.mtimeMs,
          facts.contentHash,
          facts.parser,
          facts.parserVersion,
          facts.schemaVersion,
          facts.indexedAt,
        );
        this.stmtDeleteSymbols.run(projectKey, facts.path);
        this.stmtDeleteImports.run(projectKey, facts.path);
        this.stmtDeleteExports.run(projectKey, facts.path);
        this.stmtDeleteHeadings.run(projectKey, facts.path);
        for (const symbol of facts.symbols) {
          this.stmtInsertSymbol.run(
            projectKey,
            symbol.filePath,
            symbol.symbolId,
            symbol.qualifiedName,
            symbol.name,
            symbol.kind,
            symbol.parentSymbolId ?? null,
            symbol.ordinal,
            symbol.startLine,
            symbol.endLine,
            symbol.startCol ?? null,
            symbol.endCol ?? null,
            symbol.rangeHash ?? null,
            symbol.signaturePreview ?? null,
            symbol.exportStatus,
            symbol.confidence,
            symbol.parser,
          );
        }
        for (const imp of facts.imports) {
          this.stmtInsertImport.run(projectKey, imp.filePath, imp.source, imp.importedName ?? null, imp.localName ?? null, imp.line, imp.kind, imp.confidence);
        }
        for (const exp of facts.exports) {
          this.stmtInsertExport.run(projectKey, exp.filePath, exp.exportedName, exp.localName ?? null, exp.symbolId ?? null, exp.line, exp.kind, exp.confidence);
        }
        for (const heading of facts.headings) {
          this.stmtInsertHeading.run(projectKey, heading.filePath, heading.line, heading.level, heading.text);
        }
      });
      tx();
    });
  }

  recordDenial(projectKey: string, path: string, realPathHint: string | null, policyHash: string, reason: string): void {
    this.withRetry(() => this.stmtRecordDenial.run(projectKey, path, realPathHint, policyHash, reason, new Date().toISOString()));
  }

  findSymbols(projectKey: string, query: string, opts: { kind?: string; filePath?: string; limit?: number } = {}): CodeIndexMatch[] {
    const trimmed = query.trim();
    const like = `%${trimmed.replace(/[%_]/g, "\\$&")}%`;
    const prefixLike = `${trimmed.replace(/[%_]/g, "\\$&")}%`;
    const rows = this.stmtFindSymbols.all(
      projectKey,
      opts.kind ?? null,
      opts.kind ?? null,
      opts.filePath ?? null,
      opts.filePath ?? null,
      trimmed,
      trimmed,
      like,
      like,
      trimmed,
      trimmed,
      prefixLike,
      opts.limit ?? 20,
    ) as Array<Record<string, unknown>>;
    return rows.map(rowToMatch);
  }

  symbolsForFile(projectKey: string, filePath: string): CodeSymbolRecord[] {
    return this.stmtSymbolsForFile.all(projectKey, filePath) as CodeSymbolRecord[];
  }

  symbolById(projectKey: string, filePath: string, symbolId: string): CodeSymbolRecord | null {
    return (this.stmtSymbolById.get(projectKey, filePath, symbolId) as CodeSymbolRecord | undefined) ?? null;
  }

  importsForFile(projectKey: string, filePath: string): CodeImportRecord[] {
    return this.stmtImportsForFile.all(projectKey, filePath) as CodeImportRecord[];
  }

  importsForProject(projectKey: string): CodeImportRecord[] {
    return this.stmtImportsForProject.all(projectKey) as CodeImportRecord[];
  }

  importersForSource(projectKey: string, source: string): CodeImportRecord[] {
    return this.stmtImportersForSource.all(projectKey, source) as CodeImportRecord[];
  }
}

function rowToMatch(row: Record<string, unknown>): CodeIndexMatch {
  return {
    projectKey: row.projectKey as string,
    filePath: row.filePath as string,
    symbolId: row.symbolId as string,
    qualifiedName: row.qualifiedName as string,
    name: row.name as string,
    kind: row.kind as string,
    parentSymbolId: row.parentSymbolId as string | null,
    ordinal: Number(row.ordinal),
    startLine: Number(row.startLine),
    endLine: Number(row.endLine),
    startCol: row.startCol == null ? null : Number(row.startCol),
    endCol: row.endCol == null ? null : Number(row.endCol),
    rangeHash: row.rangeHash as string | null,
    signaturePreview: row.signaturePreview as string | null,
    exportStatus: row.exportStatus as "local" | "exported" | "default",
    confidence: row.confidence as CodeIndexMatch["confidence"],
    parser: row.parser as string,
    file: {
      projectKey: row.fileProjectKey as string,
      path: row.filePathRecord as string,
      realPath: row.fileRealPath as string,
      language: row.fileLanguage as string,
      sizeBytes: Number(row.fileSizeBytes),
      mtimeMs: Number(row.fileMtimeMs),
      contentHash: row.fileContentHash as string,
      parser: row.fileParser as string,
      parserVersion: row.fileParserVersion as string,
      schemaVersion: Number(row.fileSchemaVersion),
      indexedAt: row.fileIndexedAt as string,
    },
  };
}
