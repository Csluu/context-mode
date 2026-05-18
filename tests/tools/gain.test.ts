import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeRunArtifact } from "../../src/artifacts/run-store.js";
import { resolveSessionDbPath, SessionDB } from "../../src/session/db.js";
import {
  emitParserRunEvent,
  emitRouteDecisionEvent,
  emitToolLatencyEvent,
} from "../../src/session/event-emit.js";
import { makeCtxGain } from "../../src/tools/gain.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(sessionsDir = tmpdir()): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: mkdtempSync(join(tmpdir(), "context-mode-gain-root-")),
    getSessionDir: () => sessionsDir,
    trackResponse: (_toolName, response) => response,
  };
}

describe("ctx_gain tool", () => {
  it("summarizes returned, kept-out, and sidecar bytes", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-gain-"));
    try {
      writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: "failure output",
        status: "failed",
        runId: "55555555-5555-4555-8555-555555555555",
      });
      const tool = makeCtxGain({
        getProjectDir: () => projectDir,
        getSessionStats: () => ({
          calls: { ctx_execute: 2, ctx_search: 1 },
          bytesReturned: { ctx_execute: 1000, ctx_search: 500 },
          latencyMs: { ctx_execute: 80, ctx_search: 20 },
          latencyMaxMs: { ctx_execute: 60, ctx_search: 20 },
          bytesIndexed: 4000,
          bytesSandboxed: 2000,
          cacheBytesSaved: 3000,
        }),
      });

      const text = await tool.handler({}, testContext());
      expect(text.content[0].text).toContain("ctx_gain current session");
      expect(text.content[0].text).toContain("sidecars: 1");
      expect(text.content[0].text).toContain("ctx_execute");
      expect(text.content[0].text).toContain("avg=40ms max=60ms");

      const json = await tool.handler({ json: true }, testContext());
      const payload = JSON.parse(json.content[0].text);
      expect(payload.returnedBytes).toBe(1500);
      expect(payload.keptOutBytes).toBeGreaterThan(9000);
      expect(payload.sidecarCount).toBe(1);
      expect(payload.savedPercent).toBeGreaterThan(0);
      expect(payload.byTool.find((row: { tool: string }) => row.tool === "ctx_execute").avgLatencyMs).toBe(40);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("counts only sidecars created during the current runtime session when sessionStart is available", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-gain-sidecars-"));
    const sessionStart = Date.parse("2026-05-18T12:00:00.000Z");
    try {
      writeRunArtifact({
        projectDir,
        command: "old command",
        stdout: "old output",
        status: "unknown",
        runId: "11111111-1111-4111-8111-111111111111",
        now: new Date("2026-05-18T11:59:00.000Z"),
      });
      writeRunArtifact({
        projectDir,
        command: "new command",
        stdout: "new output",
        status: "unknown",
        runId: "22222222-2222-4222-8222-222222222222",
        now: new Date("2026-05-18T12:01:00.000Z"),
      });
      const tool = makeCtxGain({
        getProjectDir: () => projectDir,
        getSessionStats: () => ({
          calls: {},
          bytesReturned: {},
          bytesIndexed: 0,
          bytesSandboxed: 0,
          cacheBytesSaved: 0,
          sessionStart,
        }),
      });

      const json = await tool.handler({ json: true }, testContext());
      const payload = JSON.parse(json.content[0].text);

      expect(payload.sidecarCount).toBe(1);
      expect(payload.sidecarBytes).toBe(Buffer.byteLength("new output"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("prefers sidecar session ids over timestamp filtering when available", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-gain-session-id-"));
    const sessionStart = Date.parse("2026-05-18T12:00:00.000Z");
    try {
      writeRunArtifact({
        projectDir,
        command: "mine",
        sessionId: "session-a",
        stdout: "mine",
        status: "unknown",
        now: new Date("2026-05-18T12:01:00.000Z"),
      });
      writeRunArtifact({
        projectDir,
        command: "other",
        sessionId: "session-b",
        stdout: "other",
        status: "unknown",
        now: new Date("2026-05-18T12:02:00.000Z"),
      });
      const tool = makeCtxGain({
        getProjectDir: () => projectDir,
        getCurrentSessionId: () => "session-a",
        getSessionStats: () => ({
          calls: {},
          bytesReturned: {},
          bytesIndexed: 0,
          bytesSandboxed: 0,
          cacheBytesSaved: 0,
          sessionStart,
        }),
      });

      const json = await tool.handler({ json: true }, testContext());
      const payload = JSON.parse(json.content[0].text);

      expect(payload.sidecarCount).toBe(1);
      expect(payload.sidecarBytes).toBe(Buffer.byteLength("mine"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("does not cap current-session sidecar accounting at 100 artifacts", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-gain-sidecar-cap-"));
    try {
      for (let i = 0; i < 101; i++) {
        writeRunArtifact({
          projectDir,
          command: `cmd-${i}`,
          stdout: "x",
          status: "unknown",
          now: new Date(2_000_000 + i),
        });
      }
      const tool = makeCtxGain({
        getProjectDir: () => projectDir,
        getSessionStats: () => ({
          calls: {},
          bytesReturned: {},
          bytesIndexed: 0,
          bytesSandboxed: 0,
          cacheBytesSaved: 0,
          sessionStart: 1_000_000,
        }),
      });

      const json = await tool.handler({ json: true }, testContext());
      const payload = JSON.parse(json.content[0].text);

      expect(payload.sidecarCount).toBe(101);
      expect(payload.sidecarBytes).toBe(101);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("can include persisted route, parser, and latency telemetry for the latest session", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-gain-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "context-mode-gain-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      const db = new SessionDB({ dbPath });
      db.ensureSession("gain-latest", projectDir);
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
        rawBytes: 2000,
        returnedBytes: 200,
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

      const tool = makeCtxGain({
        getProjectDir: () => projectDir,
        getSessionStats: () => ({
          calls: {},
          bytesReturned: {},
          bytesIndexed: 0,
          bytesSandboxed: 0,
          cacheBytesSaved: 0,
        }),
      });

      const text = await tool.handler({ session: "latest" }, testContext(sessionsDir));
      expect(text.content[0].text).toContain("Persistent telemetry (latest)");
      expect(text.content[0].text).toContain("route decisions: 1");
      expect(text.content[0].text).toContain("telemetry avoided: 1.8KB");
      expect(text.content[0].text).toContain("codex/mono");

      const json = await tool.handler({ json: true, session: "latest" }, testContext(sessionsDir));
      const payload = JSON.parse(json.content[0].text);
      expect(payload.persistentTelemetry.parserRuns).toBe(1);
      expect(payload.persistentTelemetry.topLatencyTools[0]).toMatchObject({
        tool: "ctx_execute",
        avgMs: 42,
      });
      expect(payload.persistentTelemetry.topActors[0]).toEqual({ actor: "codex/mono", count: 3 });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
