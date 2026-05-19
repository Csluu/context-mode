import { z } from "zod";

import { listRunArtifacts } from "../artifacts/run-store.js";
import { readTelemetrySummary, type TelemetrySummary } from "../session/telemetry-summary.js";
import type { GainStatsSnapshot } from "./gain.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface DiscoverDeps {
  readonly getSessionStats: () => GainStatsSnapshot;
  readonly getProjectDir: () => string;
  readonly getCurrentSessionId?: () => string | undefined;
}

interface DiscoverInput {
  readonly json?: boolean;
  readonly minBytes?: number;
  readonly session?: string;
  readonly lastDays?: number;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }> };

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function isCtxTool(tool: string): boolean {
  return tool.startsWith("ctx_");
}

function isNativeFileTool(tool: string): boolean {
  return /^(Read|Grep|Glob|Search|LS|FileRead|FileSearch|FileGlob)$/i.test(tool);
}

function requestedPersistentTelemetry(input: DiscoverInput): boolean {
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
    "Top route rules:",
    ...(summary.topRules.length > 0
      ? summary.topRules.map((row) => `- ${row.rule}: ${row.count}`)
      : ["- none"]),
    "Top parsers:",
    ...(summary.topParsers.length > 0
      ? summary.topParsers.map((row) => `- ${row.parser}: ${row.count}`)
      : ["- none"]),
    "Top adapters/agents:",
    ...(summary.topActors.length > 0
      ? summary.topActors.map((row) => `- ${row.actor}: ${row.count}`)
      : ["- none"]),
    "Top hook events:",
    ...(summary.topHooks.length > 0
      ? summary.topHooks.map((row) => `- ${row.hook}: ${row.count}`)
      : ["- none"]),
    "Top hook actions:",
    ...(summary.topHookActions.length > 0
      ? summary.topHookActions.map((row) => `- ${row.action}: ${row.count}`)
      : ["- none"]),
    "Top matched tools:",
    ...(summary.topMatchedTools.length > 0
      ? summary.topMatchedTools.map((row) => `- ${row.tool}: ${row.count}`)
      : ["- none"]),
  ];
}

function currentSessionSidecars(
  projectDir: string,
  stats: GainStatsSnapshot,
  currentSessionId?: string,
) {
  const sessionStart = Number.isFinite(stats.sessionStart)
    ? stats.sessionStart
    : undefined;
  return listRunArtifacts(projectDir, Number.MAX_SAFE_INTEGER)
    .filter((record) => {
      if (currentSessionId && record.metadata.sessionId) {
        return record.metadata.sessionId === currentSessionId;
      }
      if (!sessionStart) return true;
      const createdMs = Date.parse(record.metadata.createdAt);
      return Number.isFinite(createdMs) && createdMs >= sessionStart;
    });
}

export function makeCtxDiscover(deps: DiscoverDeps): ToolDefinition<DiscoverInput, ToolTextResult> {
  return {
    name: "ctx_discover",
    config: {
      title: "Discover Missed Savings",
      description:
        "Report current-session noisy tools, sidecar volume, and bypass categories context-mode can or cannot observe.",
      inputSchema: z.object({
        json: z.boolean().optional().describe("Return machine-readable JSON instead of text"),
        minBytes: z.coerce.number().int().nonnegative().optional().describe("Minimum returned bytes for noisy-tool findings"),
        session: z.string().optional().describe("Include persisted telemetry for a session id, or 'latest'"),
        lastDays: z.coerce.number().positive().optional().describe("Include persisted telemetry across the last N days"),
      }),
    },
    handler(input: DiscoverInput, ctx: ToolContext): ToolTextResult {
      const stats = deps.getSessionStats();
      const minBytes = input.minBytes ?? 1024;
      const noisyTools = Object.entries(stats.bytesReturned)
        .map(([tool, returnedBytes]) => ({
          tool,
          returnedBytes,
          calls: stats.calls[tool] ?? 0,
          category: isCtxTool(tool)
            ? "managed-context-output"
            : "observable-bypass",
          bypassKind: isNativeFileTool(tool)
            ? "native-file-tool"
            : isCtxTool(tool)
              ? "none"
              : "shell-or-host-tool",
          recommendation: isCtxTool(tool)
            ? "Already routed through context-mode; add intent/parser/raw-sidecar options if this returned output is still too large."
            : isNativeFileTool(tool)
              ? "Route broad file reads/searches through ctx_read or ctx_search when the adapter cannot enforce this automatically."
              : "Route through ctx_* tools when possible.",
        }))
        .filter((row) => row.returnedBytes >= minBytes)
        .sort((a, b) => b.returnedBytes - a.returnedBytes)
        .slice(0, 20);
      const sidecars = currentSessionSidecars(deps.getProjectDir(), stats, deps.getCurrentSessionId?.());
      const sidecarBytes = sidecars.reduce((sum, record) => sum + record.metadata.rawBytes, 0);
      const observedNativeFileTools = noisyTools.filter((row) => row.bypassKind === "native-file-tool");
      const observedNonCtxTools = noisyTools.filter((row) => !isCtxTool(row.tool));
      const bypassCategories = [
        {
          category: "observable-bypass",
          status: observedNonCtxTools.length > 0 ? "observed" : "none-observed",
          note: "Only visible when a host reports non-ctx tool calls into this process.",
        },
        {
          category: "unobservable-native-tool",
          status: observedNativeFileTools.length > 0 ? "observed-via-host-telemetry" : "not-measurable-yet",
          note: "Native Read/Grep/Glob bypasses require adapter event capture; otherwise they remain instruction-only risks.",
        },
        {
          category: "instruction-only-bypass",
          status: "not-measurable-yet",
          note: "Applies when the adapter cannot observe or deny native tools and only AGENTS.md/prompt rules are available.",
        },
        {
          category: "hook-missing",
          status: "not-measurable-yet",
          note: "Requires adapter installation/capability telemetry to distinguish missing hooks from silent hosts.",
        },
        {
          category: "hook-present-no-mutation",
          status: "not-measurable-yet",
          note: "Requires per-adapter hook capability events.",
        },
        {
          category: "mcp-available-not-used",
          status: noisyTools.length > 0 ? "possible" : "none-observed",
          note: "Current-session returned-byte spikes can indicate missed routing opportunities.",
        },
      ];
      const persistentTelemetry = requestedPersistentTelemetry(input)
        ? readTelemetrySummary({
          projectDir: deps.getProjectDir(),
          sessionsDir: ctx.getSessionDir(),
          session: input.session,
          lastDays: input.lastDays,
        })
        : undefined;
      const payload = {
        noisyTools,
        sidecars: {
          count: sidecars.length,
          rawBytes: sidecarBytes,
          latestRunId: sidecars[0]?.metadata.runId,
        },
        bypassCategories,
        persistentTelemetry,
      };
      if (input.json) {
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      }
      const lines = [
        "ctx_discover current session",
        "",
        "Top returned tools and bypass candidates:",
        ...(noisyTools.length > 0
          ? noisyTools.map((row, index) =>
            `${index + 1}. ${row.tool} ${fmtBytes(row.returnedBytes)} calls=${row.calls} category=${row.category} — ${row.recommendation}`)
          : ["none above threshold"]),
        "",
        `Sidecars: ${sidecars.length} (${fmtBytes(sidecarBytes)})`,
        "",
        "Bypass categories:",
        ...bypassCategories.map((item) => `- ${item.category}: ${item.status} — ${item.note}`),
        ...(persistentTelemetry ? ["", ...renderPersistentTelemetry(persistentTelemetry)] : []),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  };
}
