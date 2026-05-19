import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const ROOT = resolve(import.meta.dirname, "../..");
const CLI_TS = resolve(ROOT, "src/cli.ts");

function runHookTest(args: string[]) {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_TS, "hook", "test", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      CONTEXT_MODE_SUPPRESS_ROUTER_WARNING: "1",
    },
  });
  return {
    ...result,
    json: result.stdout ? JSON.parse(result.stdout) : null,
  };
}

describe("context-mode hook test", () => {
  it("reports recommendation-mode hook observation as JSON", () => {
    const result = runHookTest(["--adapter", "claude-code", "--json"]);

    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      adapter: "claude-code",
      routerReady: true,
      observed: true,
      action: "context",
      recommended: true,
      rewritten: false,
    });
  });

  it("reports opt-in rewrite for mutation-capable adapters", () => {
    const result = runHookTest(["--adapter", "claude-code", "--rewrite", "--json"]);

    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      adapter: "claude-code",
      action: "modify",
      rewritten: true,
    });
    expect(result.json.updatedInput.command).toContain("cli.bundle.mjs");
  });

  it("does not rewrite adapters without proven mutation support", () => {
    const result = runHookTest(["--adapter", "codex", "--rewrite", "--json"]);

    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      adapter: "codex",
      action: "deny",
      recommended: false,
      rewritten: false,
    });
    expect(result.json.reason).toContain("Codex cannot rewrite");
    expect(result.json.reason).toContain("mcp__context_mode__.ctx_execute");
  });
});
