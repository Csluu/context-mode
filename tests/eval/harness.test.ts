import { describe, expect, it } from "vitest";

import { runCtxEval, type EvalFixture } from "../../src/eval/harness.js";
import { makeCtxEval } from "../../src/tools/eval.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: process.cwd(),
    getSessionDir: () => process.cwd(),
    trackResponse: (_tool, response) => response,
  };
}

describe("ctx_eval harness", () => {
  it("passes the built-in fast pack", () => {
    const report = runCtxEval({ pack: "all", fast: true, now: new Date("2026-05-17T00:00:00.000Z") });

    expect(report.failed).toBe(false);
    expect(report.totals.passed).toBeGreaterThanOrEqual(8);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.missing).toBe(0);
  });

  it("fails forbidden-text leaks", () => {
    const secret = "SECRET=abc";
    const fixtures: EvalFixture[] = [
      {
        case: "leaky-projection",
        schemaVersion: 1,
        target: "cache",
        gateTier: "fast",
        input: { projection: { decision: "eligible", value: secret } },
        assert: { forbiddenText: [secret] },
      },
    ];

    const report = runCtxEval({ fixtures, pack: "all", fast: true });
    expect(report.failed).toBe(true);
    expect(report.failures[0].assertion).toBe("forbiddenText");
    expect(report.failures[0].message).not.toContain(secret);
    expect(report.failures[0].message).toContain("sha256=");
  });

  it("runs extra fixtures in the full gate", () => {
    const fast = runCtxEval({ pack: "all", fast: true, now: new Date("2026-05-17T00:00:00.000Z") });
    const full = runCtxEval({ pack: "all", fast: false, now: new Date("2026-05-17T00:00:00.000Z") });

    expect(full.failed).toBe(false);
    expect(full.totals.passed).toBeGreaterThan(fast.totals.passed);
  });
});

describe("ctx_eval tool", () => {
  it("returns JSON report", async () => {
    const tool = makeCtxEval();
    const result = await tool.handler({ pack: "redaction", json: true }, testContext());
    const report = JSON.parse(result.content[0].text);

    expect(report.schemaVersion).toBe(1);
    expect(report.failed).toBe(false);
    expect(report.totals.passed).toBeGreaterThanOrEqual(4);
    expect(result.isError).toBeFalsy();
  });
});
