import { describe, expect, it } from "vitest";
import {
  formatReport,
  type ConversationStats,
  type FullReport,
  type RealBytesStats,
} from "../../src/session/analytics.js";

function report(): FullReport {
  return {
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
    session: { id: "session-scope", uptime_min: "10.0" },
    continuity: { total_events: 0, by_category: [], compact_count: 0, resume_ready: false },
    projectMemory: { total_events: 0, session_count: 0, by_category: [] },
  };
}

function conversation(): ConversationStats {
  return {
    sessionId: "session-scope",
    events: 3,
    dbCount: 1,
    daysAlive: 0.1,
    snapshotBytes: 0,
    snapshotsConsumed: 0,
    byCategory: [{ category: "mcp", count: 3, label: "MCP calls" }],
    firstEventMs: Date.UTC(2026, 4, 18, 10, 0, 0),
    lastEventMs: Date.UTC(2026, 4, 18, 11, 0, 0),
    byDay: [{ ms: Date.UTC(2026, 4, 18), count: 3 }],
  };
}

function conversationBytes(): RealBytesStats {
  return {
    eventDataBytes: 1024,
    bytesAvoided: 4096,
    bytesReturned: 512,
    sandboxedMcpResponseBytes: 256,
    snapshotBytes: 0,
    contentBytes: 0,
    totalSavedTokens: 1024,
  };
}

describe("ctx_stats session scope rendering", () => {
  it("does not render lifetime bytes as all-work totals when lifetime scope is omitted", () => {
    const text = formatReport(report(), "1.0.135", null, {
      conversation: conversation(),
      realBytes: { conversation: conversationBytes() },
      cwd: "/tmp/project",
      locale: "en-US",
      tz: "UTC",
      now: Date.UTC(2026, 4, 18, 12, 0, 0),
    });

    expect(text).toContain("This conversation has 3 captures in this session.");
    expect(text).toContain("context-mode kept 4.0 KB out of this conversation.");
    expect(text).toContain("Without context-mode    4.5 KB");
    expect(text).toContain("With context-mode        512 B");
    expect(text).toContain("Sandboxed MCP responses    256 B");
    expect(text).not.toContain("context-mode kept 5.0 KB out of this conversation.");
    expect(text).toContain("Session scope only: lifetime totals were not requested.");
    expect(text).not.toContain("All your work:");
    expect(text).not.toContain("0 captures across 0 projects");
    expect(text).not.toContain("every single day");
  });
});
