import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeRunArtifact } from "../../src/artifacts/run-store.js";
import { resolveSessionDbPath, SessionDB } from "../../src/session/db.js";
import {
  emitParserRunEvent,
  emitRouteDecisionEvent,
} from "../../src/session/event-emit.js";
import { makeCtxDiscover } from "../../src/tools/discover.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(sessionsDir = tmpdir()): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: mkdtempSync(join(tmpdir(), "context-mode-discover-root-")),
    getSessionDir: () => sessionsDir,
    trackResponse: (_toolName, response) => response,
  };
}

describe("ctx_discover tool", () => {
  it("reports noisy tools, sidecars, and explicit bypass observability gaps", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-discover-"));
    try {
      writeRunArtifact({
        projectDir,
        command: "pnpm test",
        stdout: "large raw output",
        status: "failed",
        runId: "66666666-6666-4666-8666-666666666666",
      });
      const tool = makeCtxDiscover({
        getProjectDir: () => projectDir,
        getSessionStats: () => ({
          calls: { ctx_execute: 3, Bash: 1, Read: 1 },
          bytesReturned: { ctx_execute: 5000, Bash: 4000, Read: 3000 },
          bytesIndexed: 0,
          bytesSandboxed: 0,
          cacheBytesSaved: 0,
        }),
      });

      const text = await tool.handler({ minBytes: 1000 }, testContext());
      expect(text.content[0].text).toContain("ctx_discover current session");
      expect(text.content[0].text).toContain("ctx_execute");
      expect(text.content[0].text).toContain("observable-bypass");
      expect(text.content[0].text).toContain("unobservable-native-tool");
      expect(text.content[0].text).toContain("instruction-only-bypass");
      expect(text.content[0].text).toContain("hook-missing");

      const json = await tool.handler({ json: true, minBytes: 1000 }, testContext());
      const payload = JSON.parse(json.content[0].text);
      expect(payload.noisyTools).toHaveLength(3);
      expect(payload.noisyTools.find((item: { tool: string }) => item.tool === "ctx_execute")).toMatchObject({
        category: "managed-context-output",
        bypassKind: "none",
      });
      expect(payload.noisyTools.find((item: { tool: string }) => item.tool === "Read")).toMatchObject({
        bypassKind: "native-file-tool",
      });
      expect(payload.sidecars.count).toBe(1);
      expect(payload.bypassCategories.some((item: { category: string }) => item.category === "mcp-available-not-used")).toBe(true);
      expect(payload.bypassCategories.some((item: { category: string }) => item.category === "instruction-only-bypass")).toBe(true);
      expect(payload.bypassCategories.some((item: { category: string }) => item.category === "hook-missing")).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("counts only current runtime sidecars when sessionStart is available", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-discover-sidecars-"));
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

      const tool = makeCtxDiscover({
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

      expect(payload.sidecars.count).toBe(1);
      expect(payload.sidecars.rawBytes).toBe(Buffer.byteLength("new output"));
      expect(payload.sidecars.latestRunId).toBe("22222222-2222-4222-8222-222222222222");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("prefers sidecar session ids over timestamp filtering when available", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-discover-session-id-"));
    const sessionStart = Date.parse("2026-05-18T12:00:00.000Z");
    try {
      writeRunArtifact({
        projectDir,
        command: "mine",
        sessionId: "session-a",
        stdout: "mine",
        status: "unknown",
        now: new Date("2026-05-18T12:01:00.000Z"),
        runId: "33333333-3333-4333-8333-333333333333",
      });
      writeRunArtifact({
        projectDir,
        command: "other",
        sessionId: "session-b",
        stdout: "other",
        status: "unknown",
        now: new Date("2026-05-18T12:02:00.000Z"),
        runId: "44444444-4444-4444-8444-444444444444",
      });

      const tool = makeCtxDiscover({
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

      expect(payload.sidecars.count).toBe(1);
      expect(payload.sidecars.rawBytes).toBe(Buffer.byteLength("mine"));
      expect(payload.sidecars.latestRunId).toBe("33333333-3333-4333-8333-333333333333");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("can include persisted telemetry when discovering missed savings", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-discover-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "context-mode-discover-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      const db = new SessionDB({ dbPath });
      db.ensureSession("discover-latest", projectDir);
      db.close();
      emitRouteDecisionEvent({
        sessionDbPath: dbPath,
        command: "rg TODO src",
        decision: "recommend",
        selectedRule: "rg-search",
        parser: "rg",
        confidence: 0.95,
        adapter: "codex",
        agent: "mono",
      });
      emitParserRunEvent({
        sessionDbPath: dbPath,
        parser: "rg",
        status: "succeeded",
        exitCode: 0,
        rawBytes: 3000,
        returnedBytes: 500,
        adapter: "codex",
        agent: "mono",
        diagnostics: [],
      });

      const tool = makeCtxDiscover({
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
      expect(text.content[0].text).toContain("rg-search");
      expect(text.content[0].text).toContain("codex/mono");

      const json = await tool.handler({ json: true, session: "latest" }, testContext(sessionsDir));
      const payload = JSON.parse(json.content[0].text);
      expect(payload.persistentTelemetry.bytesAvoided).toBe(2500);
      expect(payload.persistentTelemetry.topParsers[0]).toMatchObject({ parser: "rg" });
      expect(payload.persistentTelemetry.topActors[0]).toEqual({ actor: "codex/mono", count: 2 });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
