import "./setup-home";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextModePlugin } from "../src/adapters/opencode/plugin.js";

type NativeTool = {
  execute: (
    args: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<string | { output?: string }>;
};

async function createPlugin(projectDir: string) {
  return ContextModePlugin({
    directory: projectDir,
    client: { app: { log: async () => undefined } },
  } as any);
}

function nativeCtx(projectDir: string) {
  return {
    sessionID: "native-tools-test-session",
    messageID: "native-tools-test-message",
    agent: "test",
    directory: projectDir,
  };
}

describe("OpenCode native ctx tools", () => {
  let projectDir: string;
  let prevEmbedded: string | undefined;

  beforeEach(() => {
    prevEmbedded = process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS;
    projectDir = mkdtempSync(join(tmpdir(), "context-mode-native-tools-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (prevEmbedded === undefined) delete process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS;
    else process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = prevEmbedded;
  });

  it("exposes registered ctx tools through the native plugin tool map", async () => {
    const plugin = await createPlugin(projectDir);
    const toolNames = Object.keys(plugin.tool ?? {});

    expect(toolNames).toContain("ctx_execute");
    expect(toolNames).toContain("ctx_read");
    expect(toolNames).toContain("ctx_batch_execute");
    expect(toolNames.length).toBeGreaterThan(10);
  });

  it("validates native tool arguments through the registered Zod schema", async () => {
    const plugin = await createPlugin(projectDir);
    const tool = plugin.tool.ctx_batch_execute as NativeTool;

    await expect(
      tool.execute(
        { commands: 123, queries: ["x"] },
        nativeCtx(projectDir),
      ),
    ).rejects.toThrow(/Invalid arguments for ctx_batch_execute/);
  });

  it("runs native tool handlers with the OpenCode project directory override", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "native-tool-project-override" }),
      "utf8",
    );
    const plugin = await createPlugin(projectDir);
    const tool = plugin.tool.ctx_read as NativeTool;

    const result = await tool.execute(
      { path: "package.json", mode: "full", reason: "small regression fixture" },
      nativeCtx(projectDir),
    );

    expect(String((result as { output?: string }).output ?? result)).toContain(
      "native-tool-project-override",
    );
  });

  it("restores CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS after native server import", async () => {
    process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "caller-value";

    await createPlugin(projectDir);

    expect(process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS).toBe("caller-value");
  });
});
