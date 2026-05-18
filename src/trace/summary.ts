import { existsSync } from "node:fs";

import { scanGuardText } from "../guard/scanner.js";
import { redactCommandShape } from "../routing/command-classifier.js";
import { resolveSessionDbPath, SessionDB, type StoredEvent } from "../session/db.js";

export interface TraceSpan {
  readonly spanId: string;
  readonly sessionId: string;
  readonly type: string;
  readonly category: string;
  readonly createdAt: string;
  readonly sourceHook: string;
  readonly bytesAvoided: number;
  readonly bytesReturned: number;
  readonly attributes: Record<string, unknown>;
}

export interface TraceRollups {
  readonly totalSpans: number;
  readonly bytesAvoided: number;
  readonly bytesReturned: number;
  readonly byType: ReadonlyArray<{ type: string; count: number; bytesAvoided: number; bytesReturned: number }>;
  readonly byTool: ReadonlyArray<{ tool: string; count: number; bytesReturned: number }>;
  readonly byParser: ReadonlyArray<{ parser: string; count: number; bytesAvoided: number; bytesReturned: number }>;
}

export interface TraceReport {
  readonly schemaVersion: 1;
  readonly available: boolean;
  readonly scope: string;
  readonly spans: readonly TraceSpan[];
  readonly rollups: TraceRollups;
  readonly warnings: readonly string[];
}

export interface ReadTraceOptions {
  readonly projectDir: string;
  readonly sessionsDir: string;
  readonly session?: string;
  readonly lastDays?: number;
  readonly limit?: number;
  readonly tool?: string;
  readonly parser?: string;
  readonly spanType?: string;
}

function parseData(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: data };
  } catch {
    return { value: data };
  }
}

function sqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sanitizeAttributes(event: StoredEvent): Record<string, unknown> {
  const data = parseData(event.data);
  const attrs: Record<string, unknown> = { ...data };
  if (typeof attrs.command === "string") attrs.command = redactCommandShape(attrs.command);
  if (typeof attrs.value === "string") {
    const value = attrs.value;
    attrs.value = value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  const guarded = scanGuardText(JSON.stringify(attrs), "trace");
  if (guarded.status === "blocked") {
    return {
      guardStatus: guarded.status,
      guardFindings: guarded.findings.map((finding) => finding.ruleId),
    };
  }
  try {
    return JSON.parse(guarded.redactedText ?? JSON.stringify(attrs)) as Record<string, unknown>;
  } catch {
    return { guardStatus: guarded.status };
  }
}

function eventToSpan(event: StoredEvent): TraceSpan {
  return {
    spanId: String(event.id),
    sessionId: event.session_id,
    type: event.type,
    category: event.category,
    createdAt: event.created_at,
    sourceHook: event.source_hook,
    bytesAvoided: Number(event.bytes_avoided ?? 0),
    bytesReturned: Number(event.bytes_returned ?? 0),
    attributes: sanitizeAttributes(event),
  };
}

function inc<K extends string>(map: Map<K, { count: number; bytesAvoided: number; bytesReturned: number }>, key: K, span: TraceSpan): void {
  const current = map.get(key) ?? { count: 0, bytesAvoided: 0, bytesReturned: 0 };
  current.count++;
  current.bytesAvoided += span.bytesAvoided;
  current.bytesReturned += span.bytesReturned;
  map.set(key, current);
}

function rollup(spans: readonly TraceSpan[]): TraceRollups {
  const byType = new Map<string, { count: number; bytesAvoided: number; bytesReturned: number }>();
  const byTool = new Map<string, { count: number; bytesAvoided: number; bytesReturned: number }>();
  const byParser = new Map<string, { count: number; bytesAvoided: number; bytesReturned: number }>();
  for (const span of spans) {
    inc(byType, span.type, span);
    const tool = typeof span.attributes.toolName === "string" ? span.attributes.toolName : undefined;
    const parser = typeof span.attributes.parser === "string" ? span.attributes.parser : undefined;
    if (tool) inc(byTool, tool, span);
    if (parser) inc(byParser, parser, span);
  }
  const sortRows = <T extends { count: number; bytesAvoided: number; bytesReturned: number }>(rows: T[]): T[] =>
    rows.sort((a, b) => (b.bytesReturned + b.bytesAvoided) - (a.bytesReturned + a.bytesAvoided) || b.count - a.count);
  return {
    totalSpans: spans.length,
    bytesAvoided: spans.reduce((sum, span) => sum + span.bytesAvoided, 0),
    bytesReturned: spans.reduce((sum, span) => sum + span.bytesReturned, 0),
    byType: sortRows(Array.from(byType.entries()).map(([type, row]) => ({ type, ...row }))).slice(0, 20),
    byTool: Array.from(byTool.entries())
      .map(([tool, row]) => ({ tool, count: row.count, bytesReturned: row.bytesReturned }))
      .sort((a, b) => b.bytesReturned - a.bytesReturned || b.count - a.count)
      .slice(0, 20),
    byParser: sortRows(Array.from(byParser.entries()).map(([parser, row]) => ({ parser, ...row }))).slice(0, 20),
  };
}

function unavailable(scope: string, warning: string): TraceReport {
  return {
    schemaVersion: 1,
    available: false,
    scope,
    spans: [],
    rollups: rollup([]),
    warnings: [warning],
  };
}

function filterSpans(spans: readonly TraceSpan[], opts: ReadTraceOptions): TraceSpan[] {
  return spans.filter((span) => {
    if (opts.spanType && span.type !== opts.spanType) return false;
    if (opts.tool && span.attributes.toolName !== opts.tool) return false;
    if (opts.parser && span.attributes.parser !== opts.parser) return false;
    return true;
  });
}

export function readTrace(opts: ReadTraceOptions): TraceReport {
  const dbPath = resolveSessionDbPath({ projectDir: opts.projectDir, sessionsDir: opts.sessionsDir });
  if (!existsSync(dbPath)) return unavailable("missing-db", "session DB not found");

  let db: SessionDB | undefined;
  try {
    db = new SessionDB({ dbPath, busyTimeoutMs: 25, retryDelays: [0] });
    const limit = opts.limit ?? 200;
    let scope = "latest";
    let events: StoredEvent[];
    if (opts.lastDays && opts.lastDays > 0) {
      const since = sqlTimestamp(new Date(Date.now() - opts.lastDays * 24 * 60 * 60 * 1000));
      events = db.getEventsSince(since, limit);
      scope = `last ${opts.lastDays}d`;
    } else {
      const sessionId = opts.session === "latest" || !opts.session ? db.getLatestSessionId() : opts.session;
      if (!sessionId) {
        return { schemaVersion: 1, available: true, scope: "latest", spans: [], rollups: rollup([]), warnings: [] };
      }
      events = db.getLatestEvents(sessionId, limit);
      scope = opts.session === "latest" || !opts.session ? "latest" : sessionId;
    }
    const spans = filterSpans(events.map(eventToSpan), opts);
    return {
      schemaVersion: 1,
      available: true,
      scope,
      spans,
      rollups: rollup(spans),
      warnings: [],
    };
  } catch (err) {
    return unavailable("error", err instanceof Error ? err.message : String(err));
  } finally {
    try { db?.close(); } catch { /* trace is best-effort */ }
  }
}

export function explainWhyBig(report: TraceReport): string[] {
  if (!report.available) return [`trace unavailable: ${report.warnings.join("; ") || "unknown reason"}`];
  const lines = [
    `trace scope: ${report.scope}`,
    `spans: ${report.rollups.totalSpans}`,
    `returned: ${report.rollups.bytesReturned}B`,
    `avoided: ${report.rollups.bytesAvoided}B`,
    "",
    "Largest span types:",
    ...(report.rollups.byType.length
      ? report.rollups.byType.slice(0, 10).map((row) => `- ${row.type}: count=${row.count} returned=${row.bytesReturned}B avoided=${row.bytesAvoided}B`)
      : ["- none"]),
    "",
    "Largest tools:",
    ...(report.rollups.byTool.length
      ? report.rollups.byTool.slice(0, 10).map((row) => `- ${row.tool}: count=${row.count} returned=${row.bytesReturned}B`)
      : ["- none"]),
    "",
    "Largest parsers:",
    ...(report.rollups.byParser.length
      ? report.rollups.byParser.slice(0, 10).map((row) => `- ${row.parser}: count=${row.count} returned=${row.bytesReturned}B avoided=${row.bytesAvoided}B`)
      : ["- none"]),
  ];
  return lines;
}
