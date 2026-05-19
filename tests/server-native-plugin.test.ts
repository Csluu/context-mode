import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ServerModule = typeof import("../src/server.js");

async function importEmbeddedServer(): Promise<ServerModule> {
  const prevEmbedded = process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS;
  process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
  try {
    return await import("../src/server.js");
  } finally {
    if (prevEmbedded === undefined) delete process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS;
    else process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = prevEmbedded;
  }
}

describe("server native plugin support", () => {
  it("can be imported for embedded native tools without starting stdio main", async () => {
    const mod = await importEmbeddedServer();

    expect(mod.server).toBeDefined();
    expect(mod.REGISTERED_CTX_TOOLS.length).toBeGreaterThan(10);
  });

  it("suppresses MCP child tools only when native plugin and legacy MCP coexist", async () => {
    const mod = await importEmbeddedServer();
    const both = {
      plugin: ["context-mode"],
      mcp: { "context-mode": { command: "node" } },
    };

    expect(
      mod.shouldSuppressMcpToolsForNativePluginHost({
        embedded: "",
        platform: "opencode",
        settings: both,
      }),
    ).toBe(true);
    expect(
      mod.shouldSuppressMcpToolsForNativePluginHost({
        embedded: "",
        platform: "kilo",
        settings: both,
      }),
    ).toBe(true);
    expect(
      mod.shouldSuppressMcpToolsForNativePluginHost({
        embedded: "1",
        platform: "opencode",
        settings: both,
      }),
    ).toBe(false);
    expect(
      mod.shouldSuppressMcpToolsForNativePluginHost({
        embedded: "",
        platform: "codex",
        settings: both,
      }),
    ).toBe(false);
    expect(
      mod.shouldSuppressMcpToolsForNativePluginHost({
        embedded: "",
        platform: "opencode",
        settings: { plugin: ["context-mode"], mcp: {} },
      }),
    ).toBe(false);
    expect(
      mod.shouldSuppressMcpToolsForNativePluginHost({
        embedded: "",
        platform: "opencode",
        settings: { plugin: [], mcp: { "context-mode": {} } },
      }),
    ).toBe(false);
  });

  it("emits the suppression diagnostic only once", async () => {
    const mod = await importEmbeddedServer();
    const chunks: string[] = [];

    mod.__resetSuppressionDiagnosticForTests();
    mod.emitSuppressionDiagnostic({ platform: "opencode", write: (s) => chunks.push(s) });
    mod.emitSuppressionDiagnostic({ platform: "opencode", write: (s) => chunks.push(s) });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("context-mode upgrade");
    expect(chunks[0]).toContain("opencode.json");
  });

  it("propagates session attribution through withProjectDirOverride", async () => {
    const mod = await importEmbeddedServer();
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-native-test-"));

    try {
      await mod.withProjectDirOverride(
        { projectDir, sessionId: "native-session-1", trusted: true },
        async () => {
          expect(mod.currentAttribution()).toEqual({ sessionId: "native-session-1" });
        },
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
