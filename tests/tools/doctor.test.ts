import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeCtxDoctor } from "../../src/tools/doctor.js";
import type { ToolContext } from "../../src/tools/types.js";

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
});
