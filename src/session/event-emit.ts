/**
 * event-emit — Phase 5+7 of D2 PRD (stats-event-driven-architecture)
 *
 * Server-side helpers that record sandbox / index / cache work into
 * `session_events` with the new `bytes_avoided` / `bytes_returned`
 * columns so the renderer can compute the real $ saved instead of the
 * conservative `events × 256` token estimate.
 *
 * Design notes
 * ────────────
 * - Uses the public `SessionDB.insertEvent(... , bytes)` API the schema
 *   engineer extended in this branch — same dedup + FIFO eviction +
 *   transaction wrapping you'd get from any other event source.
 * - Best-effort error swallowing matches `persistToolCallCounter` in
 *   `persist-tool-calls.ts`. A stats-side failure must NEVER break the
 *   parent MCP tool call.
 * - Prefer an explicit active `sessionId` from the caller. Fall back to the
 *   latest session only for legacy call sites where no active session is
 *   available.
 */

import { existsSync } from "node:fs";

import { redactText } from "../filters/pipeline.js";
import { SessionDB } from "./db.js";

/**
 * Open the SessionDB at `dbPath`, find the latest session_id, and run
 * `fn` with both. Wraps everything in try/catch so callers stay
 * fire-and-forget.
 */
function withSession(
  dbPath: string,
  sessionId: string | undefined,
  fn: (db: SessionDB, sessionId: string) => void,
): void {
  try {
    if (!existsSync(dbPath)) return;
    const sdb = new SessionDB({ dbPath, busyTimeoutMs: 1000, retryDelays: [25, 50, 100, 200] });
    try {
      const sid = sessionId || sdb.getLatestSessionId();
      if (!sid) return;
      fn(sdb, sid);
    } finally {
      try { sdb.close(); } catch { /* ignore */ }
    }
  } catch {
    // Best-effort: never break the parent MCP tool call.
  }
}

/**
 * Record a `ctx_execute` / `ctx_execute_file` / `ctx_batch_execute` run.
 * `bytesReturned` is the size of the stdout text the user actually saw —
 * the rest of the sandbox output stayed out of context.
 */
export function emitSandboxExecuteEvent(opts: {
  sessionDbPath: string;
  sessionId?: string;
  toolName: string;
  bytesReturned: number;
}): void {
  withSession(opts.sessionDbPath, opts.sessionId, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "sandbox-execute",
        category: "sandbox",
        priority: 1,
        data: opts.toolName,
        project_dir: "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
      undefined,
      { bytesReturned: opts.bytesReturned },
    );
  });
}

/**
 * Record a `ctx_index` / `trackIndexed` write — content kept out of
 * context by being chunked into FTS5 instead of returned inline.
 */
export function emitIndexWriteEvent(opts: {
  sessionDbPath: string;
  sessionId?: string;
  source: string;
  bytesAvoided: number;
}): void {
  withSession(opts.sessionDbPath, opts.sessionId, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "index-write",
        category: "sandbox",
        priority: 1,
        data: opts.source,
        project_dir: "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
      undefined,
      { bytesAvoided: opts.bytesAvoided },
    );
  });
}

/**
 * Record a `ctx_fetch_and_index` TTL cache hit — bytes the user would
 * have spent re-fetching the same URL within the 24h cache window.
 */
export function emitCacheHitEvent(opts: {
  sessionDbPath: string;
  sessionId?: string;
  source: string;
  bytesAvoided: number;
}): void {
  withSession(opts.sessionDbPath, opts.sessionId, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "cache-hit",
        category: "cache",
        priority: 1,
        data: opts.source,
        project_dir: "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
      undefined,
      { bytesAvoided: opts.bytesAvoided },
    );
  });
}

export function emitRouteDecisionEvent(opts: {
  sessionDbPath: string;
  sessionId?: string;
  command: string;
  decision: string;
  selectedRule?: string;
  parser?: string;
  confidence: number;
  adapter?: string;
  agent?: string;
  safetyReason: string;
  adapterCapabilityReason?: string;
  diagnostics?: readonly string[];
}): void {
  withSession(opts.sessionDbPath, opts.sessionId, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "route-decision",
        category: "routing",
        priority: 1,
        data: JSON.stringify({
          observedAt: new Date().toISOString(),
          command: redactText(opts.command).text,
          decision: opts.decision,
          selectedRule: opts.selectedRule,
          parser: opts.parser,
          confidence: opts.confidence,
          ...(opts.adapter ? { adapter: opts.adapter } : {}),
          ...(opts.agent ? { agent: opts.agent } : {}),
          safetyReason: opts.safetyReason,
          adapterCapabilityReason: opts.adapterCapabilityReason,
          diagnostics: opts.diagnostics ?? [],
        }),
        project_dir: "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
    );
  });
}

export function emitParserRunEvent(opts: {
  sessionDbPath: string;
  sessionId?: string;
  parser: string;
  status: string;
  exitCode: number;
  rawBytes: number;
  returnedBytes: number;
  parserConfidence?: number;
  parserConfidenceLevel?: string;
  adapter?: string;
  agent?: string;
  diagnostics?: readonly string[];
}): void {
  withSession(opts.sessionDbPath, opts.sessionId, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "parser-run",
        category: "parser",
        priority: 1,
        data: JSON.stringify({
          observedAt: new Date().toISOString(),
          parser: opts.parser,
          status: opts.status,
          exitCode: opts.exitCode,
          rawBytes: opts.rawBytes,
          returnedBytes: opts.returnedBytes,
          ...(opts.parserConfidence === undefined ? {} : { parserConfidence: opts.parserConfidence }),
          ...(opts.parserConfidenceLevel ? { parserConfidenceLevel: opts.parserConfidenceLevel } : {}),
          ...(opts.adapter ? { adapter: opts.adapter } : {}),
          ...(opts.agent ? { agent: opts.agent } : {}),
          diagnostics: opts.diagnostics ?? [],
        }),
        project_dir: "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
      undefined,
      {
        bytesAvoided: Math.max(0, opts.rawBytes - opts.returnedBytes),
        bytesReturned: 0,
      },
    );
  });
}

export function emitToolLatencyEvent(opts: {
  sessionDbPath: string;
  sessionId?: string;
  toolName: string;
  latencyMs: number;
  adapter?: string;
  agent?: string;
}): void {
  withSession(opts.sessionDbPath, opts.sessionId, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "tool-latency",
        category: "latency",
        priority: 1,
        data: JSON.stringify({
          observedAt: new Date().toISOString(),
          toolName: opts.toolName,
          latencyMs: opts.latencyMs,
          ...(opts.adapter ? { adapter: opts.adapter } : {}),
          ...(opts.agent ? { agent: opts.agent } : {}),
        }),
        project_dir: "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
    );
  });
}
