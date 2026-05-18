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
});
