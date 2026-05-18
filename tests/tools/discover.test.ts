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
