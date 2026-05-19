import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { makeCtxDoctor } from "../../src/tools/doctor.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { HookAdapter } from "../../src/adapters/types.js";

function testContext(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: join(tmpdir(), "context-mode-doctor-test"),
    getSessionDir: () => tmpdir(),
    trackResponse: (_toolName, response) => response,
  };
}

describe("ctx_doctor", () => {
  test("can return machine-readable JSON", async () => {
    const tool = makeCtxDoctor({
      VERSION: "0.0.0-test",
      getDiagnosticAdapter: async () => null,
    });

    const result = await tool.handler({ json: true }, testContext());
    const payload = JSON.parse(result.content[0].text);

    expect(payload.tool).toBe("ctx_doctor");
    expect(payload.version).toBe("0.0.0-test");
    expect(payload.counts.ok).toBeGreaterThan(0);
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks.some((check: { check: string }) => check.check === "Version")).toBe(true);
  });

  test("reports router mode/source and adapter integration tier", async () => {
    const oldRouter = process.env.CTX_MODE_ROUTER;
    process.env.CTX_MODE_ROUTER = "off";
    try {
      const adapter = {
        name: "Test Adapter",
        paradigm: "json-stdio",
        capabilities: {
          preToolUse: true,
          postToolUse: true,
          preCompact: false,
          sessionStart: false,
          canModifyArgs: true,
          canModifyOutput: false,
          canInjectSessionContext: true,
        },
        validateHooks: () => [],
        generateHookConfig: () => ({}),
      } as unknown as HookAdapter;
      const tool = makeCtxDoctor({
        VERSION: "0.0.0-test",
        getDiagnosticAdapter: async () => adapter,
      });

      const result = await tool.handler({ json: true }, testContext());
      const payload = JSON.parse(result.content[0].text);
      const text = payload.text as string;

      expect(text).toContain("Integration tier: tier 1 hook rewrite");
      expect(text).toContain("Router: mode=off source=env");
      expect(payload.checks.some((check: { check: string }) => check.check === "Integration tier")).toBe(true);
      expect(payload.checks.some((check: { check: string }) => check.check === "Router")).toBe(true);
    } finally {
      if (oldRouter === undefined) delete process.env.CTX_MODE_ROUTER;
      else process.env.CTX_MODE_ROUTER = oldRouter;
    }
  });

  test("audits OpenClaw projected Codex homes when present", async () => {
    const oldHome = process.env.CONTEXT_MODE_OPENCLAW_HOME;
    const oldOpenClawHome = process.env.OPENCLAW_HOME;
    const openclawHome = mkdtempSync(join(tmpdir(), "context-mode-openclaw-doctor-"));
    try {
      process.env.CONTEXT_MODE_OPENCLAW_HOME = openclawHome;
      delete process.env.OPENCLAW_HOME;
      for (const agent of ["mono", "mochi", "miso", "mei"]) {
        const codexHome = join(openclawHome, "agents", agent, "agent", "codex-home");
        mkdirSync(codexHome, { recursive: true });
        writeFileSync(join(codexHome, "hooks.json"), "{}\n", "utf-8");
        writeFileSync(
          join(codexHome, "config.toml"),
          [
            "[features]",
            "hooks = true",
            "",
            "[mcp_servers.context-mode]",
            "command = \"node\"",
            "",
            "[mcp_servers.context-mode.env]",
            "CONTEXT_MODE_HOST = \"codex\"",
            "",
            "[mcp_servers.serena]",
            "command = \"serena\"",
            "",
          ].join("\n"),
          "utf-8",
        );
        writeFileSync(join(codexHome, "AGENTS.md"), "# fallback\n", "utf-8");
      }

      const tool = makeCtxDoctor({
        VERSION: "0.0.0-test",
        getDiagnosticAdapter: async () => null,
      });
      const result = await tool.handler({ json: true }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(payload.text).toContain("OpenClaw Codex home mono");
      expect(payload.text).toContain("recent prompt marker");
    } finally {
      if (oldHome === undefined) delete process.env.CONTEXT_MODE_OPENCLAW_HOME;
      else process.env.CONTEXT_MODE_OPENCLAW_HOME = oldHome;
      if (oldOpenClawHome === undefined) delete process.env.OPENCLAW_HOME;
      else process.env.OPENCLAW_HOME = oldOpenClawHome;
      rmSync(openclawHome, { recursive: true, force: true });
    }
  });

  test("scopes OpenClaw prompt marker evidence to each projected agent", async () => {
    const oldHome = process.env.CONTEXT_MODE_OPENCLAW_HOME;
    const oldOpenClawHome = process.env.OPENCLAW_HOME;
    const openclawHome = mkdtempSync(join(tmpdir(), "context-mode-openclaw-doctor-marker-"));
    try {
      process.env.CONTEXT_MODE_OPENCLAW_HOME = openclawHome;
      delete process.env.OPENCLAW_HOME;
      for (const agent of ["mono", "mochi", "miso", "mei"]) {
        const codexHome = join(openclawHome, "agents", agent, "agent", "codex-home");
        mkdirSync(codexHome, { recursive: true });
        writeFileSync(join(codexHome, "hooks.json"), "{}\n", "utf-8");
        writeFileSync(
          join(codexHome, "config.toml"),
          [
            "[features]",
            "hooks = true",
            "",
            "[mcp_servers.context-mode]",
            "command = \"node\"",
            "",
            "[mcp_servers.context-mode.env]",
            "CONTEXT_MODE_HOST = \"codex\"",
            "",
            "[mcp_servers.serena]",
            "command = \"serena\"",
            "",
          ].join("\n"),
          "utf-8",
        );
        writeFileSync(join(codexHome, "AGENTS.md"), "# fallback\n", "utf-8");
      }
      const monoWorkspace = join(openclawHome, "workspace-mono");
      mkdirSync(monoWorkspace, { recursive: true });
      writeFileSync(join(monoWorkspace, "session.log"), "<!-- context-mode: routing block injected -->\n", "utf-8");
      const sharedSessions = join(openclawHome, "sessions");
      mkdirSync(sharedSessions, { recursive: true });
      writeFileSync(join(sharedSessions, "shared.log"), "<!-- context-mode: routing block injected -->\n", "utf-8");

      const tool = makeCtxDoctor({
        VERSION: "0.0.0-test",
        getDiagnosticAdapter: async () => null,
      });
      const result = await tool.handler({ json: true }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(payload.text).toContain("OpenClaw Codex home mono: complete");
      expect(payload.text).toContain("OpenClaw Codex home mochi: missing recent prompt marker");
    } finally {
      if (oldHome === undefined) delete process.env.CONTEXT_MODE_OPENCLAW_HOME;
      else process.env.CONTEXT_MODE_OPENCLAW_HOME = oldHome;
      if (oldOpenClawHome === undefined) delete process.env.OPENCLAW_HOME;
      else process.env.OPENCLAW_HOME = oldOpenClawHome;
      rmSync(openclawHome, { recursive: true, force: true });
    }
  });
});
