import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDatabase } from "../../src/db-base.js";
import { AnalyticsEngine, formatReport, getRealBytesStats, type ConversationStats, type FullReport, type RealBytesStats } from "../../src/session/analytics.js";
import { resolveSessionDbPath, SessionDB } from "../../src/session/db.js";

describe("getRealBytesStats", () => {
  it("does not fall back to latest session when stats caller passes an unresolved session", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ctx-queryall-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "ctx-queryall-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      const db = new SessionDB({ dbPath });
      db.ensureSession("parent-session", projectDir);
      db.ensureSession("latest-subagent-session", projectDir);
      db.insertEvent(
        "latest-subagent-session",
        {
          type: "subagent-note",
          category: "subagent",
          priority: 1,
          data: "latest session should not be used implicitly",
        },
        "test",
      );
      db.close();

      const Database = loadDatabase();
      const rawDb = new Database(dbPath, { readonly: true });
      try {
        const report = new AnalyticsEngine(rawDb).queryAll({
          calls: {},
          bytesReturned: {},
          bytesIndexed: 0,
          bytesSandboxed: 0,
          cacheHits: 0,
          cacheBytesSaved: 0,
          sessionStart: Date.now(),
        }, { sessionId: null });

        expect(report.session.id).toBe("");
        expect(report.continuity.total_events).toBe(0);
      } finally {
        rawDb.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it("uses persistent tool-call returned bytes and excludes event metadata from saved tokens", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ctx-real-bytes-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "ctx-real-bytes-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      const db = new SessionDB({ dbPath });
      db.ensureSession("real-session", projectDir);
      db.insertEvent(
        "real-session",
        {
          type: "index-write",
          category: "sandbox",
          priority: 1,
          data: "telemetry payload that is stored but not returned to the model",
        },
        "test",
        undefined,
        { bytesAvoided: 4000, bytesReturned: 500 },
      );
      db.incrementToolCall("real-session", "ctx_read", 1500);
      db.incrementToolCall("real-session", "ctx_execute", 700);
      db.close();

      const stats = getRealBytesStats({ sessionId: "real-session", sessionsDir });

      expect(stats.bytesAvoided).toBe(4000);
      expect(stats.bytesReturned).toBe(2200);
      expect(stats.sandboxedMcpResponseBytes).toBe(700);
      expect(stats.eventDataBytes).toBeGreaterThan(0);
      expect(stats.totalSavedTokens).toBe(1000);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it("renders sidecar raw bytes in the conversation narrative when folded into real bytes", () => {
    const report: FullReport = {
      savings: {
        processed_kb: 0,
        entered_kb: 0,
        saved_kb: 0,
        pct: 0,
        savings_ratio: 0,
        by_tool: [],
        total_calls: 0,
        total_bytes_returned: 0,
        kept_out: 0,
        total_processed: 0,
      },
      session: { id: "sidecar-session", uptime_min: "5.0" },
      continuity: { total_events: 0, by_category: [], compact_count: 0, resume_ready: false },
      projectMemory: { total_events: 0, session_count: 0, by_category: [] },
    };
    const conversation: ConversationStats = {
      sessionId: "sidecar-session",
      events: 1,
      dbCount: 1,
      daysAlive: 0.1,
      snapshotBytes: 0,
      snapshotsConsumed: 0,
      byCategory: [{ category: "mcp", count: 1, label: "MCP calls" }],
      firstEventMs: Date.UTC(2026, 4, 18, 10, 0, 0),
      lastEventMs: Date.UTC(2026, 4, 18, 10, 5, 0),
      byDay: [{ ms: Date.UTC(2026, 4, 18), count: 1 }],
    };
    const realBytes: RealBytesStats = {
      eventDataBytes: 0,
      bytesAvoided: 8192,
      bytesReturned: 512,
      sandboxedMcpResponseBytes: 8192,
      snapshotBytes: 0,
      contentBytes: 0,
      totalSavedTokens: 2048,
    };

    const text = formatReport(report, "1.0.135", null, {
      conversation,
      realBytes: { conversation: realBytes },
      cwd: "/tmp/project",
      locale: "en-US",
      tz: "UTC",
      now: Date.UTC(2026, 4, 18, 12, 0, 0),
    });

    expect(text).toContain("context-mode kept 8.0 KB out of this conversation.");
    expect(text).toContain("Without context-mode    8.5 KB");
    expect(text).toContain("Sandboxed MCP responses   8.0 KB");
  });
});
