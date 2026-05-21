import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectGitTextDiff, renderDiffSummary, type CtxDiffResult } from "../../src/diff/git-text.js";
import { makeCtxDiff } from "../../src/tools/diff.js";
import type { ToolContext } from "../../src/tools/types.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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

  it("supports explicit Git ref ranges", () => {
    const dir = initRepo();
    try {
      writeFileSync(join(dir, "src.ts"), "export const value = 5;\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-m", "update value"]);

      const result = collectGitTextDiff({
        repoDir: dir,
        from: gitOutput(dir, ["rev-parse", "HEAD~1"]),
        to: gitOutput(dir, ["rev-parse", "HEAD"]),
      });

      expect(result.provider.status).toBe("ok");
      expect(result.inventory.some((item) => item.path === "src.ts" && item.status === "modified")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects option-like refs and invalid ref combinations", () => {
    const dir = initRepo();
    try {
      const optionRef = collectGitTextDiff({ repoDir: dir, from: "--output=unsafe" });
      expect(optionRef.provider.status).toBe("failed");
      expect(optionRef.warnings.join("\n")).toContain("from ref must be a Git revision");

      const multilineRef = collectGitTextDiff({ repoDir: dir, from: "HEAD\n--stat" });
      expect(multilineRef.provider.status).toBe("failed");
      expect(multilineRef.warnings.join("\n")).toContain("from ref must be a Git revision");

      const pathspecRef = collectGitTextDiff({ repoDir: dir, from: "src.ts" });
      expect(pathspecRef.provider.status).toBe("failed");
      expect(pathspecRef.warnings.join("\n")).toContain("from ref does not resolve to a Git revision");

      const targetOnly = collectGitTextDiff({ repoDir: dir, to: "HEAD" });
      expect(targetOnly.provider.status).toBe("failed");
      expect(targetOnly.warnings.join("\n")).toContain("to ref requires a from ref");

      const stagedWithRefs = collectGitTextDiff({ repoDir: dir, staged: true, from: "HEAD" });
      expect(stagedWithRefs.provider.status).toBe("failed");
      expect(stagedWithRefs.warnings.join("\n")).toContain("staged mode cannot be combined");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("escapes control characters in rendered summaries", () => {
    const result: CtxDiffResult = {
      schemaVersion: 1,
      provider: {
        name: "git-text",
        status: "ok",
        elapsedMs: 1,
        maxInputBytes: 4096,
      },
      inventory: [
        {
          path: "line\nbreak.ts",
          oldPath: "old\rpath.ts",
          status: "renamed",
          additions: 1,
          deletions: 0,
        },
      ],
      semanticGroups: [
        {
          kind: "textual",
          files: ["line\nbreak.ts"],
          summary: "Regular textual/code changes.",
          confidence: "medium",
        },
      ],
      risk: {
        level: "medium",
        reasonCodes: ["renames"],
        summary: "1 file(s), 1 changed line(s), risk medium",
      },
      warnings: ["warning\nnext"],
    };

    const summary = renderDiffSummary(result);

    expect(summary).toContain("line\\nbreak.ts");
    expect(summary).toContain("old\\rpath.ts");
    expect(summary).toContain("warning\\nnext");
    expect(summary).not.toContain("line\nbreak.ts");
    expect(summary).not.toContain("warning\nnext");
  });
});

describe("ctx_diff tool", () => {
  it("returns JSON summary without raw diff body", async () => {
    const dir = initRepo();
    try {
      writeFileSync(join(dir, "src.ts"), "export const value = 3;\n");
      const tool = makeCtxDiff({
        getProjectDir: () => process.cwd(),
        resolveProjectDirOverride: (projectDir) => projectDir,
      });
      const result = await tool.handler({ json: true, semantic: true, projectDir: dir }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(tool.experimental).toBeUndefined();
      expect(payload.schemaVersion).toBe(1);
      expect(payload.rawDiff).toBeUndefined();
      expect(payload.inventory[0].path).toBe("src.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
