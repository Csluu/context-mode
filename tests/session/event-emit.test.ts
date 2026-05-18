import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionDB } from "../../src/session/db.js";
import {
  emitParserRunEvent,
  emitRouteDecisionEvent,
  emitToolLatencyEvent,
} from "../../src/session/event-emit.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempDbPath(): string {
  const dbPath = join(tmpdir(), `context-mode-event-emit-${randomUUID()}.db`);
  cleanups.push(() => rmSync(dbPath, { force: true }));
  cleanups.push(() => rmSync(`${dbPath}-wal`, { force: true }));
  cleanups.push(() => rmSync(`${dbPath}-shm`, { force: true }));
  return dbPath;
}

describe("session event emitters", () => {
  it("persists route, parser, and latency telemetry against the latest session", () => {
    const dbPath = tempDbPath();
    const sid = "telemetry-session";
    const db = new SessionDB({ dbPath });
    db.ensureSession(sid, "/repo");
    db.close();

    emitRouteDecisionEvent({
      sessionDbPath: dbPath,
      command: "pnpm test",
      decision: "recommend",
      selectedRule: "node-test-generic",
      parser: "generic-failure",
      confidence: 0.9,
      adapter: "codex",
      agent: "mono",
      safetyReason: "recommendation mode",
    });
    emitParserRunEvent({
      sessionDbPath: dbPath,
      parser: "generic-failure",
      status: "failed",
      exitCode: 1,
      rawBytes: 2000,
      returnedBytes: 200,
      parserConfidence: 0.78,
      parserConfidenceLevel: "medium",
      adapter: "codex",
      agent: "mono",
      diagnostics: [],
    });
    emitToolLatencyEvent({
      sessionDbPath: dbPath,
      toolName: "ctx_execute",
      latencyMs: 42,
      adapter: "codex",
      agent: "mono",
    });

    const verify = new SessionDB({ dbPath });
    try {
      const route = verify.getEvents(sid, { type: "route-decision" });
      const parser = verify.getEvents(sid, { type: "parser-run" });
      const latency = verify.getEvents(sid, { type: "tool-latency" });

      expect(route).toHaveLength(1);
      expect(JSON.parse(route[0].data)).toMatchObject({
        command: "pnpm test",
        decision: "recommend",
        selectedRule: "node-test-generic",
        adapter: "codex",
        agent: "mono",
      });
      expect(parser).toHaveLength(1);
      expect(parser[0].bytes_avoided).toBe(1800);
      expect(parser[0].bytes_returned).toBe(0);
      expect(JSON.parse(parser[0].data)).toMatchObject({
        parser: "generic-failure",
        status: "failed",
        parserConfidence: 0.78,
        parserConfidenceLevel: "medium",
        adapter: "codex",
        agent: "mono",
      });
      expect(latency).toHaveLength(1);
      expect(JSON.parse(latency[0].data)).toMatchObject({
        toolName: "ctx_execute",
        latencyMs: 42,
      });
    } finally {
      verify.close();
    }
  });

  it("uses an explicit session id instead of the newer latest session", () => {
    const dbPath = tempDbPath();
    const db = new SessionDB({ dbPath });
    db.ensureSession("session-a", "/repo");
    db.ensureSession("session-b", "/repo");
    db.close();

    emitRouteDecisionEvent({
      sessionDbPath: dbPath,
      sessionId: "session-a",
      command: "git diff",
      decision: "recommend",
      confidence: 0.9,
      safetyReason: "explicit session",
    });

    const verify = new SessionDB({ dbPath });
    try {
      expect(verify.getEvents("session-a", { type: "route-decision" })).toHaveLength(1);
      expect(verify.getEvents("session-b", { type: "route-decision" })).toHaveLength(0);
    } finally {
      verify.close();
    }
  });

  it("redacts secrets from route-decision command telemetry", () => {
    const dbPath = tempDbPath();
    const sid = "telemetry-redaction-session";
    const db = new SessionDB({ dbPath });
    db.ensureSession(sid, "/repo");
    db.close();

    emitRouteDecisionEvent({
      sessionDbPath: dbPath,
      sessionId: sid,
      command: "node script.js OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz",
      decision: "recommend",
      confidence: 0.9,
      safetyReason: "redaction regression",
    });

    const verify = new SessionDB({ dbPath });
    try {
      const events = verify.getEvents(sid, { type: "route-decision" });
      expect(events).toHaveLength(1);
      const data = JSON.parse(events[0].data);
      expect(data.command).toContain("OPENAI_API_KEY=<redacted>");
      expect(data.command).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    } finally {
      verify.close();
    }
  });

  it("drops parser telemetry instead of throwing when analytics DB open fails", () => {
    const badDbPath = mkdtempSync(join(tmpdir(), "context-mode-event-emit-bad-db-"));
    cleanups.push(() => rmSync(badDbPath, { recursive: true, force: true }));

    expect(() =>
      emitParserRunEvent({
        sessionDbPath: badDbPath,
        parser: "generic-failure",
        status: "failed",
        exitCode: 1,
        rawBytes: 1000,
        returnedBytes: 100,
        diagnostics: ["simulated analytics store failure"],
      })
    ).not.toThrow();
  });
});
