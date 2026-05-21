import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, test } from "vitest";
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

function toMsysPath(filePath: string): string {
  return `/${filePath[0].toLowerCase()}${filePath.slice(2).replace(/\\/g, "/")}`;
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
      expect(ok.content[0].text).toMatch(/(function|binding)/);

      const compact = await tool.handler({ path: "src/App.ts", mode: "symbols", compact: true }, testContext());
      expect(compact.isError).toBeUndefined();
      expect(compact.content[0].text).toContain("symbols compact");
      expect(compact.content[0].text).toMatch(/provider: (typescript-compiler confidence=high|heuristic confidence=low)/);
      expect(compact.content[0].text).toMatch(/L00001 (function|binding) App/);

      const compactSlice = await tool.handler({ path: "src/App.ts", mode: "slice", compact: true, start: 1, end: 1 }, testContext());
      expect(compactSlice.isError).toBeUndefined();
      expect(compactSlice.content[0].text).toBe("1: export const App = () => null;");

      const autoCompactSlice = await tool.handler({ path: "src/App.ts", mode: "slice", start: 1, end: 1 }, testContext());
      expect(autoCompactSlice.isError).toBeUndefined();
      expect(autoCompactSlice.content[0].text).toBe("1: export const App = () => null;");

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

  it("blocks absolute files outside the default project root unless allowlisted", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-default-"));
    const actualProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-actual-"));
    const previousAllowed = process.env.CONTEXT_MODE_ALLOWED_READ_DIRS;
    try {
      writeFileSync(join(actualProjectDir, "package.json"), "{\"name\":\"actual\"}\n", "utf8");
      mkdirSync(join(actualProjectDir, "src"), { recursive: true });
      const file = join(actualProjectDir, "src", "App.ts");
      writeFileSync(file, "export const App = () => null;\n", "utf8");
      const tool = makeCtxRead({ getProjectDir: () => defaultProjectDir });

      const denied = await tool.handler({ path: file, mode: "symbols" }, testContext());
      expect(denied.isError).toBe(true);
      expect(denied.content[0].text).toContain("CTX_READ_ABSOLUTE_PATH_OUTSIDE_PROJECT");

      process.env.CONTEXT_MODE_ALLOWED_READ_DIRS = actualProjectDir;
      const ok = await tool.handler({ path: file, mode: "symbols" }, testContext());

      expect(ok.isError).toBeUndefined();
      expect(ok.content[0].text).toContain("ctx_read symbols:");
      expect(ok.content[0].text).toContain(file);
    } finally {
      if (previousAllowed === undefined) delete process.env.CONTEXT_MODE_ALLOWED_READ_DIRS;
      else process.env.CONTEXT_MODE_ALLOWED_READ_DIRS = previousAllowed;
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(actualProjectDir, { recursive: true, force: true });
    }
  });

  test.runIf(process.platform === "win32")("normalizes MSYS-style absolute paths for the actual read", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-default-"));
    const actualProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-msys-"));
    const previousAllowed = process.env.CONTEXT_MODE_ALLOWED_READ_DIRS;
    try {
      writeFileSync(join(actualProjectDir, "package.json"), "{\"name\":\"actual\"}\n", "utf8");
      const file = join(actualProjectDir, "README.md");
      writeFileSync(file, "# MSYS Path\n\nmsys-path-marker\n", "utf8");
      const tool = makeCtxRead({ getProjectDir: () => defaultProjectDir });
      process.env.CONTEXT_MODE_ALLOWED_READ_DIRS = actualProjectDir;

      const ok = await tool.handler({ path: toMsysPath(file), mode: "full", reason: "small regression fixture" }, testContext());

      expect(ok.isError).toBeUndefined();
      expect(ok.content[0].text).toContain("msys-path-marker");
      expect(ok.content[0].text).toContain(file);
    } finally {
      if (previousAllowed === undefined) delete process.env.CONTEXT_MODE_ALLOWED_READ_DIRS;
      else process.env.CONTEXT_MODE_ALLOWED_READ_DIRS = previousAllowed;
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(actualProjectDir, { recursive: true, force: true });
    }
  });

  test.runIf(process.platform === "win32")("reports likely unescaped drive-relative Windows paths", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-read-winpath-"));
    try {
      const tool = makeCtxRead({ getProjectDir: () => projectDir });

      const result = await tool.handler({ path: "C:Users\\chris\\file.ts", mode: "symbols" }, testContext());

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("drive-relative or unescaped");
      expect(result.content[0].text).toContain("C:/path");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
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

  it("blocks sensitive absolute files outside the default project root before reading them", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-default-"));
    const actualProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-sensitive-"));
    try {
      writeFileSync(join(actualProjectDir, "package.json"), "{\"name\":\"actual\"}\n", "utf8");
      const file = join(actualProjectDir, ".env");
      writeFileSync(file, "SECRET_TOKEN=hidden\n", "utf8");
      const tool = makeCtxRead({ getProjectDir: () => defaultProjectDir });

      const denied = await tool.handler({ path: file, mode: "full", reason: "test" }, testContext());

      expect(denied.isError).toBe(true);
      expect(denied.content[0].text).toContain("CTX_READ_ABSOLUTE_PATH_OUTSIDE_PROJECT");
      expect(denied.content[0].text).not.toContain("hidden");
    } finally {
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(actualProjectDir, { recursive: true, force: true });
    }
  });

  it("supports multiple explicit external read roots", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-read-default-"));
    const firstRoot = mkdtempSync(join(tmpdir(), "context-mode-read-first-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "context-mode-read-second-"));
    const previousAllowed = process.env.CONTEXT_MODE_ALLOWED_READ_DIRS;
    try {
      const file = join(secondRoot, "notes.md");
      writeFileSync(file, "# Notes\n\nexternal-root-marker\n", "utf8");
      process.env.CONTEXT_MODE_ALLOWED_READ_DIRS = [firstRoot, secondRoot].join(delimiter);
      const tool = makeCtxRead({ getProjectDir: () => defaultProjectDir });

      const ok = await tool.handler({ path: file, mode: "full", reason: "small regression fixture" }, testContext());

      expect(ok.isError).toBeUndefined();
      expect(ok.content[0].text).toContain("external-root-marker");
    } finally {
      if (previousAllowed === undefined) delete process.env.CONTEXT_MODE_ALLOWED_READ_DIRS;
      else process.env.CONTEXT_MODE_ALLOWED_READ_DIRS = previousAllowed;
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });
});
