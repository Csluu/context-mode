import { existsSync } from "node:fs";

import { resolveSessionDbPath, SessionDB, type StoredEvent } from "./db.js";

export interface TelemetrySummaryOptions {
  readonly projectDir: string;
  readonly sessionsDir: string;
  readonly session?: string;
  readonly lastDays?: number;
  readonly limit?: number;
}

export interface TelemetrySummary {
  readonly available: boolean;
  readonly scope: string;
  readonly sessions: readonly string[];
  readonly routeDecisions: number;
  readonly parserRuns: number;
  readonly latencyEvents: number;
  readonly bytesAvoided: number;
  readonly bytesReturned: number;
  readonly topRules: ReadonlyArray<{ rule: string; count: number }>;
  readonly topParsers: ReadonlyArray<{ parser: string; count: number }>;
  readonly topLatencyTools: ReadonlyArray<{ tool: string; count: number; avgMs: number; maxMs: number }>;
  readonly topActors: ReadonlyArray<{ actor: string; count: number }>;
}

function sqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseJson(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function inc(map: Map<string, number>, key: string | undefined): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topCounts(map: Map<string, number>, fallback: string): Array<{ rule: string; count: number }> {
  return Array.from(map.entries())
    .map(([rule, count]) => ({ rule: rule || fallback, count }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule))
    .slice(0, 10);
}

function topParserCounts(map: Map<string, number>): Array<{ parser: string; count: number }> {
  return Array.from(map.entries())
    .map(([parser, count]) => ({ parser, count }))
    .sort((a, b) => b.count - a.count || a.parser.localeCompare(b.parser))
    .slice(0, 10);
}

function topActorCounts(map: Map<string, number>): Array<{ actor: string; count: number }> {
  return Array.from(map.entries())
    .map(([actor, count]) => ({ actor, count }))
    .sort((a, b) => b.count - a.count || a.actor.localeCompare(b.actor))
    .slice(0, 10);
}

function actorFromData(data: Record<string, unknown>): string | undefined {
  const adapter = typeof data.adapter === "string" && data.adapter.trim()
    ? data.adapter.trim()
    : undefined;
  const agent = typeof data.agent === "string" && data.agent.trim()
    ? data.agent.trim()
    : undefined;
  if (adapter && agent) return `${adapter}/${agent}`;
  return adapter ?? agent;
}

function summarizeEvents(events: readonly StoredEvent[], scope: string): TelemetrySummary {
  const sessions = new Set<string>();
  const rules = new Map<string, number>();
  const parsers = new Map<string, number>();
  const actors = new Map<string, number>();
  const latency = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  let routeDecisions = 0;
  let parserRuns = 0;
  let latencyEvents = 0;
  let bytesAvoided = 0;
  let bytesReturned = 0;

  for (const event of events) {
    sessions.add(event.session_id);
    bytesAvoided += Number(event.bytes_avoided ?? 0);
    bytesReturned += Number(event.bytes_returned ?? 0);
    const data = parseJson(event.data);
    inc(actors, actorFromData(data));
    if (event.type === "route-decision") {
      routeDecisions++;
      inc(rules, typeof data.selectedRule === "string" ? data.selectedRule : "no-rule");
    } else if (event.type === "parser-run") {
      parserRuns++;
      inc(parsers, typeof data.parser === "string" ? data.parser : "unknown");
    } else if (event.type === "tool-latency") {
      latencyEvents++;
      const tool = typeof data.toolName === "string" ? data.toolName : "unknown";
      const latencyMs = typeof data.latencyMs === "number" && Number.isFinite(data.latencyMs)
        ? data.latencyMs
        : 0;
      const existing = latency.get(tool) ?? { count: 0, totalMs: 0, maxMs: 0 };
      existing.count++;
      existing.totalMs += latencyMs;
      existing.maxMs = Math.max(existing.maxMs, latencyMs);
      latency.set(tool, existing);
    }
  }

  const topLatencyTools = Array.from(latency.entries())
    .map(([tool, value]) => ({
      tool,
      count: value.count,
      avgMs: value.count > 0 ? Math.round(value.totalMs / value.count) : 0,
      maxMs: value.maxMs,
    }))
    .sort((a, b) => b.avgMs - a.avgMs || b.count - a.count || a.tool.localeCompare(b.tool))
    .slice(0, 10);

  return {
    available: true,
    scope,
    sessions: Array.from(sessions).sort(),
    routeDecisions,
    parserRuns,
    latencyEvents,
    bytesAvoided,
    bytesReturned,
    topRules: topCounts(rules, "no-rule"),
    topParsers: topParserCounts(parsers),
    topLatencyTools,
    topActors: topActorCounts(actors),
  };
}

function unavailable(scope: string): TelemetrySummary {
  return {
    available: false,
    scope,
    sessions: [],
    routeDecisions: 0,
    parserRuns: 0,
    latencyEvents: 0,
    bytesAvoided: 0,
    bytesReturned: 0,
    topRules: [],
    topParsers: [],
    topLatencyTools: [],
    topActors: [],
  };
}

export function readTelemetrySummary(opts: TelemetrySummaryOptions): TelemetrySummary {
  const dbPath = resolveSessionDbPath({ projectDir: opts.projectDir, sessionsDir: opts.sessionsDir });
  if (!existsSync(dbPath)) {
    return unavailable("missing-db");
  }

  let db: SessionDB | undefined;
  try {
    db = new SessionDB({ dbPath, busyTimeoutMs: 25, retryDelays: [0] });
    const limit = opts.limit ?? 5000;
    if (opts.lastDays && opts.lastDays > 0) {
      const since = sqlTimestamp(new Date(Date.now() - opts.lastDays * 24 * 60 * 60 * 1000));
      return summarizeEvents(db.getEventsSince(since, limit), `last ${opts.lastDays}d`);
    }

    const sessionId = opts.session === "latest" || !opts.session
      ? db.getLatestSessionId()
      : opts.session;
    if (!sessionId) {
      return summarizeEvents([], "latest");
    }
    return summarizeEvents(db.getEvents(sessionId, { limit }), opts.session === "latest" || !opts.session ? "latest" : sessionId);
  } catch {
    return unavailable("error");
  } finally {
    try { db?.close(); } catch { /* telemetry is best-effort */ }
  }
}
