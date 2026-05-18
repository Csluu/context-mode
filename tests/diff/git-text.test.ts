import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectGitTextDiff } from "../../src/diff/git-text.js";
import { makeCtxDiff } from "../../src/tools/diff.js";
import type { ToolContext } from "../../src/tools/types.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ctx-diff-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  writeFileSync(join(dir, "src.ts"), "export const value = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

function testContext(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: process.cwd(),
    getSessionDir: () => process.cwd(),
    trackResponse: (_tool, response) => response,
  };
}

describe("git text diff", () => {
  it("preserves raw Git inventory and semantic groups", () => {
    const dir = initRepo();
    try {
      mkdirSync(join(dir, "tests"));
      writeFileSync(join(dir, "src.ts"), "export const value = 2;\n");
      writeFileSync(join(dir, "tests", "src.test.ts"), "expect(value).toBe(2);\n");

      const result = collectGitTextDiff({ repoDir: dir });

      expect(result.provider.status).toBe("ok");
      expect(result.inventory.some((item) => item.path === "src.ts" && item.status === "modified")).toBe(true);
      expect(result.semanticGroups.some((group) => group.kind === "test")).toBe(false);

      git(dir, ["add", "tests/src.test.ts"]);
      const staged = collectGitTextDiff({ repoDir: dir, staged: true });
      expect(staged.inventory.some((item) => item.path === "tests/src.test.ts" && item.status === "added")).toBe(true);
      expect(staged.semanticGroups.some((group) => group.kind === "test")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps inventory when raw diff capture exceeds the budget", () => {
    const dir = initRepo();
    try {
      writeFileSync(join(dir, "src.ts"), `export const value = "${"x".repeat(20_000)}";\n`);

      const result = collectGitTextDiff({ repoDir: dir, includeRaw: true, maxInputBytes: 4096 });

      expect(result.provider.status).toBe("fallback");
      expect(result.inventory.some((item) => item.path === "src.ts" && item.status === "modified")).toBe(true);
      expect(result.rawDiff).toBeUndefined();
      expect(result.warnings.join("\n")).toContain("raw diff omitted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to git inventory when difftastic is unavailable", () => {
    const dir = initRepo();
    try {
      writeFileSync(join(dir, "src.ts"), "export const value = 4;\n");

      const result = collectGitTextDiff({
        repoDir: dir,
        semantic: true,
        difftasticCommand: "definitely-not-context-mode-difftastic",
      });

      expect(result.provider.name).toBe("git-text");
      expect(result.provider.status).toBe("fallback");
      expect(result.inventory.some((item) => item.path === "src.ts" && item.status === "modified")).toBe(true);
      expect(result.warnings.join("\n")).toContain("difftastic unavailable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ctx_diff tool", () => {
  it("returns JSON summary without raw diff body", async () => {
    const dir = initRepo();
    try {
      writeFileSync(join(dir, "src.ts"), "export const value = 3;\n");
      const tool = makeCtxDiff({ getProjectDir: () => dir });
      const result = await tool.handler({ json: true, semantic: true }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(payload.schemaVersion).toBe(1);
      expect(payload.rawDiff).toBeUndefined();
      expect(payload.inventory[0].path).toBe("src.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
