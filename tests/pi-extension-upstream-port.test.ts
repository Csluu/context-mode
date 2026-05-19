import "./setup-home";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadDatabase } from "../src/db-base.js";

type Handler = (...args: any[]) => any;

function createMockPiApi() {
  const handlers: Record<string, Handler[]> = {};
  return {
    on: (event: string, handler: Handler) => {
      (handlers[event] ??= []).push(handler);
    },
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    sendMessage: vi.fn(),
    exec: vi.fn(),
    async trigger(event: string, ...args: any[]) {
      for (const handler of handlers[event] ?? []) {
        const result = await handler(...args);
        if (result !== undefined) return result;
      }
      return undefined;
    },
  };
}

function sessionIdFor(sessionFile: string): string {
  return createHash("sha256").update(sessionFile).digest("hex").slice(0, 16);
}

describe("Pi extension upstream-port behavior", () => {
  let projectDir: string;
  let originalArgv: string[];

  beforeEach(() => {
    projectDir = mkdtempSync(join(homedir(), "pi-extension-upstream-"));
    mkdirSync(projectDir, { recursive: true });
    process.env.PI_PROJECT_DIR = projectDir;
    process.env.PI_WORKSPACE_DIR = projectDir;
    originalArgv = [...process.argv];
    process.argv = [process.argv[0] ?? "node", "pi", "--help"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    delete process.env.PI_PROJECT_DIR;
    delete process.env.PI_WORKSPACE_DIR;
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function register(api: ReturnType<typeof createMockPiApi>) {
    const mod = await import("../src/adapters/pi/extension.js");
    mod.default(api);
  }

  it("stores Pi events with workspace-root project attribution", async () => {
    const api = createMockPiApi();
    const sessionFile = `attr-${Date.now()}`;
    const sessionId = sessionIdFor(sessionFile);
    await register(api);

    await api.trigger("session_start", {}, {
      sessionManager: { getSessionFile: () => sessionFile },
    });
    await api.trigger("tool_result", {
      toolName: "custom-tool",
      input: { value: 1 },
      result: "done",
    });

    const Database = loadDatabase();
    const dbPath = join(homedir(), ".pi", "context-mode", "sessions", "context-mode.db");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare(
        `SELECT project_dir, attribution_source, attribution_confidence
         FROM session_events
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      ).get(sessionId) as
        | { project_dir: string; attribution_source: string; attribution_confidence: number }
        | undefined;

      expect(row?.project_dir).toBe(projectDir);
      expect(row?.attribution_source).toBe("workspace_root");
      expect(row?.attribution_confidence).toBeCloseTo(0.98);
    } finally {
      db.close();
    }
    await api.trigger("session_shutdown");
  });

  it("places the behavioral directive after the resume snapshot", async () => {
    const api = createMockPiApi();
    const sessionFile = `ordering-${Date.now()}`;
    await register(api);

    await api.trigger("session_start", {}, {
      sessionManager: { getSessionFile: () => sessionFile },
    });
    await api.trigger("before_agent_start", {
      prompt: "You are a senior staff engineer reviewing this codebase.",
      systemPrompt: "Base.",
    });
    await api.trigger("session_before_compact");

    const result = await api.trigger("before_agent_start", {
      systemPrompt: "Base final.",
    });
    const systemPrompt = String(result?.systemPrompt ?? "");

    expect(systemPrompt).toContain("<session_resume");
    expect(systemPrompt).toContain("<behavioral_directive>");
    expect(systemPrompt.indexOf("<behavioral_directive>")).toBeGreaterThan(
      systemPrompt.indexOf("<session_resume"),
    );
    await api.trigger("session_shutdown");
  });
});
