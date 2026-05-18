import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSessionDbPath, SessionDB } from "../../src/session/db.js";
import {
  emitParserRunEvent,
  emitRouteDecisionEvent,
  emitToolLatencyEvent,
} from "../../src/session/event-emit.js";
import { readTelemetrySummary } from "../../src/session/telemetry-summary.js";

describe("telemetry summary", () => {
  it("summarizes persisted route, parser, and latency events", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-telemetry-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "context-mode-telemetry-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      const db = new SessionDB({ dbPath });
      db.ensureSession("telemetry-latest", projectDir);
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
      });
      emitParserRunEvent({
        sessionDbPath: dbPath,
        parser: "generic-failure",
        status: "failed",
        exitCode: 1,
        rawBytes: 2500,
        returnedBytes: 250,
        adapter: "codex",
        agent: "mono",
        diagnostics: [],
      });
      emitToolLatencyEvent({
        sessionDbPath: dbPath,
        toolName: "ctx_execute",
        latencyMs: 99,
        adapter: "codex",
        agent: "mono",
      });

      const summary = readTelemetrySummary({ projectDir, sessionsDir, session: "latest" });
      expect(summary.available).toBe(true);
      expect(summary.sessions).toEqual(["telemetry-latest"]);
      expect(summary.routeDecisions).toBe(1);
      expect(summary.parserRuns).toBe(1);
      expect(summary.latencyEvents).toBe(1);
      expect(summary.bytesAvoided).toBe(2250);
      expect(summary.bytesReturned).toBe(0);
      expect(summary.topRules[0]).toEqual({ rule: "node-test-generic", count: 1 });
      expect(summary.topParsers[0]).toEqual({ parser: "generic-failure", count: 1 });
      expect(summary.topLatencyTools[0]).toMatchObject({ tool: "ctx_execute", avgMs: 99, maxMs: 99 });
      expect(summary.topActors[0]).toEqual({ actor: "codex/mono", count: 3 });

      const windowed = readTelemetrySummary({ projectDir, sessionsDir, lastDays: 1 });
      expect(windowed.scope).toBe("last 1d");
      expect(windowed.parserRuns).toBe(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it("reports unavailable when the project session database does not exist", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-telemetry-missing-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "context-mode-telemetry-missing-sessions-"));
    try {
      const summary = readTelemetrySummary({ projectDir, sessionsDir, session: "latest" });
      expect(summary.available).toBe(false);
      expect(summary.routeDecisions).toBe(0);
      expect(summary.topRules).toEqual([]);
      expect(summary.topActors).toEqual([]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it("fails open when the session database cannot be opened", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-telemetry-error-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "context-mode-telemetry-error-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      mkdirSync(dbPath, { recursive: true });

      const summary = readTelemetrySummary({ projectDir, sessionsDir, session: "latest" });
      expect(summary.available).toBe(false);
      expect(summary.scope).toBe("error");
      expect(summary.routeDecisions).toBe(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
