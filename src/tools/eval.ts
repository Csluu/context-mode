import { z } from "zod";

import { runCtxEval, type RunEvalOptions } from "../eval/harness.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface EvalInput {
  readonly pack?: RunEvalOptions["pack"];
  readonly fast?: boolean;
  readonly json?: boolean;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function render(report: ReturnType<typeof runCtxEval>): string {
  const lines = [
    `ctx_eval ${report.failed ? "FAILED" : "passed"}`,
    `passed: ${report.totals.passed}`,
    `failed: ${report.totals.failed}`,
    `missing: ${report.totals.missing}`,
  ];
  if (report.failures.length > 0) {
    lines.push("", "Failures:");
    for (const failure of report.failures) {
      lines.push(`- ${failure.severity} ${failure.case} ${failure.assertion}: ${failure.message}`);
    }
  }
  return lines.join("\n");
}

export function makeCtxEval(): ToolDefinition<EvalInput, ToolTextResult> {
  return {
    name: "ctx_eval",
    experimental: true,
    config: {
      title: "Context-Mode Eval Harness",
      description:
        "Run deterministic parser, router, redaction, cache, diff, and omission fixtures. Fails on critical regressions or missing fast packs.",
      inputSchema: z.object({
        pack: z.enum(["all", "parsers", "router", "redaction", "tool-broker", "no-critical-omissions"]).optional().default("all"),
        fast: z.boolean().optional().default(true),
        json: z.boolean().optional().describe("Return JSON report"),
      }),
    },
    handler(input: EvalInput, _ctx: ToolContext): ToolTextResult {
      const report = runCtxEval({ pack: input.pack ?? "all", fast: input.fast ?? true });
      return {
        content: [{ type: "text", text: input.json ? JSON.stringify(report, null, 2) : render(report) }],
        isError: report.failed,
      };
    },
  };
}
