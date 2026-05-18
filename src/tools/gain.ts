import { z } from "zod";

import { listRunArtifacts } from "../artifacts/run-store.js";
import { readTelemetrySummary, type TelemetrySummary } from "../session/telemetry-summary.js";
import type { ToolContext, ToolDefinition } from "./types.js";

export interface GainStatsSnapshot {
  readonly calls: Record<string, number>;
  readonly bytesReturned: Record<string, number>;
  readonly latencyMs?: Record<string, number>;
  readonly latencyMaxMs?: Record<string, number>;
  readonly bytesIndexed: number;
  readonly bytesSandboxed: number;
  readonly cacheBytesSaved: number;
}

interface GainDeps {
  readonly getSessionStats: () => GainStatsSnapshot;
  readonly getProjectDir: () => string;
}

interface GainInput {
  readonly json?: boolean;
  readonly session?: string;
  readonly lastDays?: number;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }> };

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function requestedPersistentTelemetry(input: GainInput): boolean {
  return Boolean(input.session || input.lastDays);
}

function renderPersistentTelemetry(summary: TelemetrySummary): string[] {
  if (!summary.available) {
    return [`Persistent telemetry (${summary.scope}): unavailable`];
  }
  return [
    `Persistent telemetry (${summary.scope})`,
    `sessions: ${summary.sessions.length}`,
    `route decisions: ${summary.routeDecisions}`,
    `parser runs: ${summary.parserRuns}`,
    `latency events: ${summary.latencyEvents}`,
    `telemetry avoided: ${fmtBytes(summary.bytesAvoided)}`,
    `telemetry returned: ${fmtBytes(summary.bytesReturned)}`,
    "Top route rules:",
    ...(summary.topRules.length > 0
      ? summary.topRules.map((row) => `- ${row.rule}: ${row.count}`)
      : ["- none"]),
    "Top parsers:",
    ...(summary.topParsers.length > 0
      ? summary.topParsers.map((row) => `- ${row.parser}: ${row.count}`)
      : ["- none"]),
    "Top latency:",
    ...(summary.topLatencyTools.length > 0
      ? summary.topLatencyTools.map((row) => `- ${row.tool}: count=${row.count} avg=${row.avgMs}ms max=${row.maxMs}ms`)
      : ["- none"]),
    "Top adapters/agents:",
    ...(summary.topActors.length > 0
      ? summary.topActors.map((row) => `- ${row.actor}: ${row.count}`)
      : ["- none"]),
  ];
}

export function makeCtxGain(deps: GainDeps): ToolDefinition<GainInput, ToolTextResult> {
  return {
    name: "ctx_gain",
    config: {
      title: "Context Savings Summary",
      description:
        "Summarize current-session context savings from indexed, sandboxed, cached, and sidecar output.",
      inputSchema: z.object({
        json: z.boolean().optional().describe("Return machine-readable JSON instead of text"),
        session: z.string().optional().describe("Include persisted telemetry for a session id, or 'latest'"),
        lastDays: z.coerce.number().positive().optional().describe("Include persisted telemetry across the last N days"),
      }),
    },
    handler(input: GainInput, ctx: ToolContext): ToolTextResult {
      const stats = deps.getSessionStats();
      const returned = Object.values(stats.bytesReturned).reduce((sum, value) => sum + value, 0);
      const sidecars = listRunArtifacts(deps.getProjectDir(), 100);
      const sidecarBytes = sidecars.reduce((sum, record) => sum + record.metadata.rawBytes, 0);
      const keptOut = stats.bytesIndexed + stats.bytesSandboxed + stats.cacheBytesSaved + sidecarBytes;
      const totalObserved = returned + keptOut;
      const savedPercent = totalObserved > 0 ? Math.round((keptOut / totalObserved) * 100) : 0;
      const byTool = Object.keys({ ...stats.calls, ...stats.bytesReturned, ...(stats.latencyMs ?? {}) })
        .sort()
        .map((tool) => ({
          tool,
          calls: stats.calls[tool] ?? 0,
          returnedBytes: stats.bytesReturned[tool] ?? 0,
          latencyMs: stats.latencyMs?.[tool] ?? 0,
          avgLatencyMs: stats.calls[tool]
            ? Math.round((stats.latencyMs?.[tool] ?? 0) / stats.calls[tool])
            : 0,
          maxLatencyMs: stats.latencyMaxMs?.[tool] ?? 0,
        }));
      const persistentTelemetry = requestedPersistentTelemetry(input)
        ? readTelemetrySummary({
          projectDir: deps.getProjectDir(),
          sessionsDir: ctx.getSessionDir(),
          session: input.session,
          lastDays: input.lastDays,
        })
        : undefined;
      const payload = {
        returnedBytes: returned,
        keptOutBytes: keptOut,
        savedPercent,
        indexedBytes: stats.bytesIndexed,
        sandboxedBytes: stats.bytesSandboxed,
        cacheBytesSaved: stats.cacheBytesSaved,
        sidecarBytes,
        sidecarCount: sidecars.length,
        byTool,
        persistentTelemetry,
      };
      if (input.json) {
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      }
      const lines = [
        "ctx_gain current session",
        "",
        `returned: ${fmtBytes(returned)}`,
        `kept out: ${fmtBytes(keptOut)}`,
        `savings: ${savedPercent}%`,
        `indexed: ${fmtBytes(stats.bytesIndexed)}`,
        `sandboxed: ${fmtBytes(stats.bytesSandboxed)}`,
        `cache saved: ${fmtBytes(stats.cacheBytesSaved)}`,
        `sidecars: ${sidecars.length} (${fmtBytes(sidecarBytes)})`,
        "",
        "Top returned tools:",
        ...byTool
          .sort((a, b) => b.returnedBytes - a.returnedBytes)
          .slice(0, 10)
          .map((row) => {
            const latency = row.avgLatencyMs > 0 ? ` avg=${row.avgLatencyMs}ms max=${row.maxLatencyMs}ms` : "";
            return `- ${row.tool}: calls=${row.calls} returned=${fmtBytes(row.returnedBytes)}${latency}`;
          }),
        ...(persistentTelemetry ? ["", ...renderPersistentTelemetry(persistentTelemetry)] : []),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  };
}
