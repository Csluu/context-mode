import { z } from "zod";

import { explainWhyBig, readTrace } from "../trace/summary.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface TraceDeps {
  readonly getProjectDir: () => string;
}

interface TraceInput {
  readonly latest?: boolean;
  readonly session?: string;
  readonly lastDays?: number;
  readonly limit?: number;
  readonly spanType?: string;
  readonly tool?: string;
  readonly parser?: string;
  readonly whyBig?: boolean;
  readonly toolBreakdown?: boolean;
  readonly json?: boolean;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function renderToolBreakdown(report: ReturnType<typeof readTrace>): string {
  return [
    `ctx_trace tool breakdown (${report.scope})`,
    `available: ${report.available}`,
    "",
    ...(
      report.rollups.byTool.length
        ? report.rollups.byTool.map((row) => `- ${row.tool}: count=${row.count} returned=${row.bytesReturned}B`)
        : ["- none"]
    ),
  ].join("\n");
}

function renderLatest(report: ReturnType<typeof readTrace>): string {
  const lines = [
    `ctx_trace ${report.scope}`,
    `available: ${report.available}`,
    `spans: ${report.rollups.totalSpans}`,
    `returned: ${report.rollups.bytesReturned}B`,
    `avoided: ${report.rollups.bytesAvoided}B`,
  ];
  if (report.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  if (report.spans.length > 0) {
    lines.push("", "Latest spans:");
    for (const span of report.spans.slice(-10)) {
      const tool = typeof span.attributes.toolName === "string" ? ` tool=${span.attributes.toolName}` : "";
      const parser = typeof span.attributes.parser === "string" ? ` parser=${span.attributes.parser}` : "";
      lines.push(`- ${span.createdAt} ${span.type}${tool}${parser} returned=${span.bytesReturned}B avoided=${span.bytesAvoided}B`);
    }
  }
  return lines.join("\n");
}

export function makeCtxTrace(deps: TraceDeps): ToolDefinition<TraceInput, ToolTextResult> {
  return {
    name: "ctx_trace",
    experimental: true,
    config: {
      title: "Local Trace Observability",
      description:
        "Inspect local session trace spans, token/context causes, tool breakdowns, parser activity, and fail-open telemetry state.",
      inputSchema: z.object({
        latest: z.boolean().optional().describe("Use latest session"),
        session: z.string().optional().describe("Session id or 'latest'"),
        lastDays: z.coerce.number().positive().optional().describe("Read events from the last N days"),
        limit: z.coerce.number().int().positive().max(5000).optional().describe("Max spans"),
        spanType: z.string().optional().describe("Filter by span/event type"),
        tool: z.string().optional().describe("Filter by tool name"),
        parser: z.string().optional().describe("Filter by parser name"),
        whyBig: z.boolean().optional().describe("Explain why context usage was large"),
        toolBreakdown: z.boolean().optional().describe("Return tool breakdown"),
        json: z.boolean().optional().describe("Return JSON"),
      }),
    },
    handler(input: TraceInput, ctx: ToolContext): ToolTextResult {
      const report = readTrace({
        projectDir: deps.getProjectDir(),
        sessionsDir: ctx.getSessionDir(),
        session: input.session ?? (input.latest ? "latest" : undefined),
        lastDays: input.lastDays,
        limit: input.limit,
        tool: input.tool,
        parser: input.parser,
        spanType: input.spanType,
      });
      if (input.json) return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], isError: !report.available };
      if (input.whyBig) return { content: [{ type: "text", text: explainWhyBig(report).join("\n") }], isError: !report.available };
      if (input.toolBreakdown) return { content: [{ type: "text", text: renderToolBreakdown(report) }], isError: !report.available };
      return { content: [{ type: "text", text: renderLatest(report) }], isError: !report.available };
    },
  };
}
