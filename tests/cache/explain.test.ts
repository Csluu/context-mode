import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter } from "node:path";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { explainTaskCache } from "../../src/cache/explain.js";
import { runTaskCached } from "../../src/cache/run.js";
import { makeCtxCache } from "../../src/tools/cache.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: process.cwd(),
    getSessionDir: () => process.cwd(),
    trackResponse: (_tool, response) => response,
  };
}

describe("task cache explain", () => {
  it("marks deterministic commands eligible but keeps serving disabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-cache-explain-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "tsconfig.json"), "{}");
      const result = explainTaskCache({ command: "tsc --noEmit", cwd: dir, env: { CI: "1" } });

      expect(result.decision).toBe("eligible");
      expect(result.servingEnabled).toBe(false);
      expect(result.commandFamily).toBe("tsc-noemit");
      expect(result.cacheKey).toMatch(/^[a-f0-9]{32}$/);
      expect(result.reasonCodes).toContain("serving-disabled");
      expect(result.invalidationInputs.some((input) => input.name === "src/index.ts")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bypasses interactive or side-effectful commands", () => {
    const result = explainTaskCache({ command: "npm install", cwd: process.cwd() });

    expect(result.decision).toBe("bypass");
    expect(result.reasonCodes).toContain("never-cache-command");
    expect(result.cacheKey).toBeUndefined();
  });

  it("refuses to execute bypass commands in ctx_cache run mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-cache-refuse-"));
    try {
      const marker = join(dir, "should-not-exist.txt");
      const result = runTaskCached({
        command: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')"`,
        cwd: dir,
        env: process.env,
      });

      expect(result.status).toBe("bypass");
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("refused to execute");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires direct deterministic test commands before marking cache eligible", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-cache-vitest-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      const direct = explainTaskCache({ command: "vitest run", cwd: dir });
      const packageScript = explainTaskCache({ command: "pnpm test", cwd: dir });

      expect(direct.decision).toBe("eligible");
      expect(direct.commandFamily).toBe("vitest-run");
      expect(packageScript.decision).toBe("bypass");
      expect(packageScript.reasonCodes).toContain("no-approved-command-family");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bypasses git working tree reads until worktree fingerprints exist", () => {
    const result = explainTaskCache({ command: "git diff", cwd: process.cwd() });

    expect(result.decision).toBe("bypass");
    expect(result.reasonCodes).toContain("git-working-tree-state-not-fingerprinted");
  });

  it("includes TypeScript source files in tsc cache invalidation", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-cache-source-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true }, include: ["src"] }));
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "index.ts"), "export const value = 1;\n");

      const result = explainTaskCache({ command: "tsc --noEmit", cwd: dir });
      expect(result.invalidationInputs.some((input) => input.name === join("src", "index.ts"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves explicit tsc cache hits and invalidates when source changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-cache-run-"));
    const env = {
      ...process.env,
      PATH: `${resolve(process.cwd(), "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
    };
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ["src"] }));
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "index.ts"), "export const value: number = 1;\n");

      const first = runTaskCached({ command: "tsc --noEmit", cwd: dir, env });
      const second = runTaskCached({ command: "tsc --noEmit", cwd: dir, env });
      expect(first.status).toBe("miss");
      expect(first.wroteEntry).toBe(true);
      expect(second.status).toBe("hit");
      expect(second.exitCode).toBe(0);

      writeFileSync(join(dir, "src", "index.ts"), "export const value: number = 'bad';\n");
      const invalidated = runTaskCached({ command: "tsc --noEmit", cwd: dir, env });
      expect(invalidated.status).toBe("miss");
      expect(invalidated.exitCode).not.toBe(0);
      expect(invalidated.stderr + invalidated.stdout).toContain("Type 'string' is not assignable to type 'number'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts legacy cached stdout before returning a cache hit", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-cache-redact-hit-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true }, include: ["src"] }));
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "index.ts"), "export const value = 1;\n");

      const explain = explainTaskCache({ command: "tsc --noEmit", cwd: dir });
      mkdirSync(join(dir, ".context-mode", "task-cache"), { recursive: true });
      writeFileSync(join(dir, ".context-mode", "task-cache", `${explain.cacheKey}.json`), JSON.stringify({
        schemaVersion: 1,
        cacheKey: explain.cacheKey,
        createdAt: new Date().toISOString(),
        commandFamily: "tsc-noemit",
        commandShape: "tsc --noEmit",
        exitCode: 0,
        stdout: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz\n",
        stderr: "",
        stdoutBytes: 48,
        stderrBytes: 0,
        sha256: "legacy",
      }, null, 2));

      const hit = runTaskCached({ command: "tsc --noEmit", cwd: dir });

      expect(hit.status).toBe("hit");
      expect(hit.stdout).toContain("OPENAI_API_KEY=<redacted>");
      expect(hit.stdout).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not inherit MCP stdin when executing approved cache commands", () => {
    const source = readFileSync(resolve(process.cwd(), "src/cache/run.ts"), "utf8");

    expect(source).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(source).not.toContain('stdio: ["inherit", "pipe", "pipe"]');
  });
});

describe("ctx_cache tool", () => {
  it("explains a command as JSON", async () => {
    const tool = makeCtxCache({ getProjectDir: () => process.cwd() });
    const result = await tool.handler({ mode: "explain", command: "pnpm test", json: true }, testContext());
    const payload = JSON.parse(result.content[0].text);

    expect(payload.schemaVersion).toBe(1);
    expect(payload.servingEnabled).toBe(false);
  });
});
