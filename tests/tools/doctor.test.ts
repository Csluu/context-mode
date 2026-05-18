import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
