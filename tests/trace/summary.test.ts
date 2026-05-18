import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveSessionDbPath, SessionDB } from "../../src/session/db.js";
import { explainWhyBig, readTrace } from "../../src/trace/summary.js";
import { makeCtxTrace } from "../../src/tools/trace.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(sessionsDir: string): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: process.cwd(),
    getSessionDir: () => sessionsDir,
    trackResponse: (_tool, response) => response,
  };
}

describe("trace summary", () => {
  it("reads session events and redacts sensitive trace attributes", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ctx-trace-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "ctx-trace-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      const db = new SessionDB({ dbPath });
      db.ensureSession("session-1", projectDir);
      db.insertEvent(
        "session-1",
        {
          type: "route-decision",
          category: "routing",
          priority: 1,
          data: JSON.stringify({ command: "TOKEN=secretvalue pnpm test", selectedRule: "node-test-generic" }),
        },
        "test",
        undefined,
        { bytesReturned: 100 },
      );
      db.insertEvent(
        "session-1",
        {
          type: "parser-run",
          category: "parser",
          priority: 1,
          data: JSON.stringify({ parser: "node-test-generic", status: "failed" }),
        },
        "test",
        undefined,
        { bytesAvoided: 900, bytesReturned: 100 },
      );
      db.close();

      const report = readTrace({ projectDir, sessionsDir, session: "latest" });
      const rendered = JSON.stringify(report);

      expect(report.available).toBe(true);
      expect(report.rollups.totalSpans).toBe(2);
      expect(report.rollups.bytesAvoided).toBe(900);
      expect(report.rollups.byParser[0].parser).toBe("node-test-generic");
      expect(rendered).not.toContain("secretvalue");
      expect(explainWhyBig(report).join("\n")).toContain("Largest parsers");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it("applies the limit to the newest session events", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ctx-trace-latest-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "ctx-trace-latest-sessions-"));
    try {
      const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
      const db = new SessionDB({ dbPath });
      db.ensureSession("session-latest", projectDir);
      for (const toolName of ["oldest", "middle", "newest"]) {
        db.insertEvent(
          "session-latest",
          {
            type: "tool-call",
            category: "tool",
            priority: 1,
            data: JSON.stringify({ toolName }),
          },
          "test",
        );
      }
      db.close();

      const report = readTrace({ projectDir, sessionsDir, session: "latest", limit: 1 });

      expect(report.spans).toHaveLength(1);
      expect(report.spans[0].attributes.toolName).toBe("newest");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});

describe("ctx_trace tool", () => {
  it("fails open when DB is missing", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ctx-trace-missing-project-"));
    const sessionsDir = mkdtempSync(join(tmpdir(), "ctx-trace-missing-sessions-"));
    try {
      const tool = makeCtxTrace({ getProjectDir: () => projectDir });
      const result = await tool.handler({ json: true }, testContext(sessionsDir));
      const report = JSON.parse(result.content[0].text);

      expect(report.available).toBe(false);
      expect(result.isError).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
