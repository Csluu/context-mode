import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeCtxRead } from "../../src/tools/read.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: mkdtempSync(join(tmpdir(), "context-mode-read-tool-root-")),
    getSessionDir: () => tmpdir(),
    trackResponse: (_toolName, response) => response,
  };
}

describe("ctx_read tool", () => {
  it("returns compact read output and structured failures", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-read-tool-"));
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(join(projectDir, "src", "App.ts"), "export const App = () => null;\n", "utf8");
      const tool = makeCtxRead({ getProjectDir: () => projectDir });

      const ok = await tool.handler({ path: "src/App.ts", mode: "symbols" }, testContext());
      expect(ok.isError).toBeUndefined();
      expect(ok.content[0].text).toContain("ctx_read symbols:");
      expect(ok.content[0].text).toMatch(/provider: (typescript-compiler|heuristic)/);
      expect(ok.content[0].text).toContain("binding");

      const err = await tool.handler({ path: "../outside.ts" }, testContext());
      expect(err.isError).toBe(true);
      expect(err.content[0].text).toContain("CTX_READ_FAILED");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("honors the server Read deny policy before ctxRead touches the file", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-read-tool-deny-"));
    try {
      mkdirSync(join(projectDir, ".git"), { recursive: true });
      writeFileSync(join(projectDir, ".git", "config"), "[remote]\n  url = secret\n", "utf8");
      const tool = makeCtxRead({
        getProjectDir: () => projectDir,
        checkFilePath: (path) => path.includes(".git/config")
          ? { content: [{ type: "text", text: "File access blocked by security policy" }], isError: true }
          : null,
      });

      const denied = await tool.handler({ path: ".git/config", mode: "full", reason: "test" }, testContext());
      expect(denied.isError).toBe(true);
      expect(denied.content[0].text).toContain("blocked");
      expect(denied.content[0].text).not.toContain("secret");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("can read an absolute file outside the default project root", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-default-"));
    const actualProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-actual-"));
    try {
      writeFileSync(join(actualProjectDir, "package.json"), "{\"name\":\"actual\"}\n", "utf8");
      mkdirSync(join(actualProjectDir, "src"), { recursive: true });
      const file = join(actualProjectDir, "src", "App.ts");
      writeFileSync(file, "export const App = () => null;\n", "utf8");
      const tool = makeCtxRead({ getProjectDir: () => defaultProjectDir });

      const ok = await tool.handler({ path: file, mode: "symbols" }, testContext());

      expect(ok.isError).toBeUndefined();
      expect(ok.content[0].text).toContain("ctx_read symbols:");
      expect(ok.content[0].text).toContain(file);
    } finally {
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(actualProjectDir, { recursive: true, force: true });
    }
  });

  it("guides users when an explicit projectDir blocks an absolute non-project file", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-default-"));
    const docsDir = mkdtempSync(join(tmpdir(), "context-mode-read-docs-"));
    try {
      const file = join(docsDir, "SKILL.md");
      writeFileSync(file, "# Skill\n\nRead-only docs.\n", "utf8");
      const tool = makeCtxRead({ getProjectDir: () => defaultProjectDir });

      const err = await tool.handler({ path: file, projectDir: defaultProjectDir, mode: "outline" }, testContext());

      expect(err.isError).toBe(true);
      expect(err.content[0].text).toContain("CTX_READ_FAILED");
      expect(err.content[0].text).toContain("omit projectDir");
      expect(err.content[0].text).toContain("ctx_index(path)");
    } finally {
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(docsDir, { recursive: true, force: true });
    }
  });

  it("blocks sensitive absolute files outside the default project root", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-default-"));
    const actualProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-sensitive-"));
    try {
      writeFileSync(join(actualProjectDir, "package.json"), "{\"name\":\"actual\"}\n", "utf8");
      const file = join(actualProjectDir, ".env");
      writeFileSync(file, "SECRET_TOKEN=hidden\n", "utf8");
      const tool = makeCtxRead({ getProjectDir: () => defaultProjectDir });

      const denied = await tool.handler({ path: file, mode: "full", reason: "test" }, testContext());

      expect(denied.isError).toBe(true);
      expect(denied.content[0].text).toContain("sensitive file blocked");
      expect(denied.content[0].text).not.toContain("hidden");
    } finally {
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(actualProjectDir, { recursive: true, force: true });
    }
  });
});
