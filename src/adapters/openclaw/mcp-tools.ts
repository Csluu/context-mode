/**
 * OpenClaw MCP tool registry.
 *
 * Catalogs the ctx_* tools that OpenClaw plugin must register via
 * api.registerTool(...) so the routing block (which nudges agents toward
 * ctx_execute, ctx_search, etc.) actually has tools to call. Without this,
 * Phase 7 audit (v1.0.107-adapter-openclaw.json) flagged severity=CRITICAL —
 * routing-block premise is broken when the named tools don't exist.
 *
 * Pattern mirrors the swarmvault MCP plugin
 * (refs/plugin-examples/openclaw/swarmvault/packages/engine/src/mcp.ts:46-51):
 *   server.registerTool(name, { description, inputSchema }, handler)
 *
 * OpenClaw signature is slightly different — see building-plugins.md:116
 *   api.registerTool({ name, description, parameters: TypeBox, execute(id, params) })
 *
 * Tool handlers are intentionally bridge stubs today. They register the ctx_*
 * names so routing guidance is not dangling, then direct callers to the
 * standalone MCP transport/CLI instead of re-exporting the whole server stack
 * inside OpenClaw's process.
 *
 * The definitions mirror src/server.ts names and schemas enough for OpenClaw
 * registration. Full execution remains owned by the standalone MCP server.
 */

/** Minimal JSON-schema-like parameter spec accepted by OpenClaw registerTool. */
export interface OpenClawJsonSchema {
  type: string;
  description?: string;
  items?: OpenClawJsonSchema;
  properties?: Record<string, OpenClawJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface OpenClawToolParameters {
  type: "object";
  properties: Record<string, OpenClawJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Tool definition shape returned to OpenClaw via api.registerTool. */
export interface OpenClawToolDef {
  name: string;
  experimental?: boolean;
  description: string;
  parameters: OpenClawToolParameters;
  execute: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

/** Wrap any handler so failures become a well-formed text error rather than crashing. */
function safe(
  handler: (
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>,
): OpenClawToolDef["execute"] {
  return async (_id, params) => {
    try {
      return await handler(params ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `[context-mode] tool error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  };
}

/** Bridge stub — points users at the standalone MCP/CLI for full functionality. */
function cliRedirect(toolName: string) {
  const cliFallbacks: Record<string, string> = {
    ctx_guard: "context-mode guard scan-fixtures --json",
    ctx_eval: "context-mode eval all --json",
    ctx_trace: "context-mode trace --latest --json",
    ctx_diff: "context-mode diff --json",
    ctx_cache: "context-mode cache explain -- <command>",
    ctx_route: "context-mode route --explain <command>",
  };
  const fallback = cliFallbacks[toolName];
  return safe(async () => ({
    content: [
      {
        type: "text" as const,
        text: fallback
          ? `[context-mode] ${toolName} is an OpenClaw bridge stub, not the real Context Mode MCP tool. Prefer the standalone MCP tool mcp__context_mode__.${toolName}; if it is not visible, use tool_search with query "context-mode ${toolName}". CLI fallback: '${fallback}'.`
          : `[context-mode] ${toolName} is an OpenClaw bridge stub, not the real Context Mode MCP tool. Prefer the standalone MCP tool mcp__context_mode__.${toolName}; if it is not visible, use tool_search with query "context-mode ${toolName}".`,
      },
    ],
  }));
}

/**
 * The ctx_* tool definitions registered into OpenClaw via api.registerTool.
 * Names + descriptions mirror src/server.ts registerTool blocks so prompts
 * referencing them (routing block, AGENTS.md) resolve to registered bridge
 * tools even before OpenClaw supports direct MCP handler delegation.
 */
const OPENCLAW_BRIDGE_TOOL_DEFS: readonly OpenClawToolDef[] = [
  {
    name: "ctx_execute",
    description:
      "Execute code in a sandboxed subprocess. Only stdout enters context. Prefer over Bash for any command producing >20 lines.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", description: "Runtime language" },
        code: { type: "string", description: "Source code to execute" },
        timeout: { type: "number", description: "Max execution time in ms" },
        background: { type: "boolean", description: "Keep process running after timeout" },
        intent: { type: "string", description: "What to extract when output is large" },
        parser: { type: "string", description: "Optional explicit output parser" },
        projectDir: {
          type: "string",
          description: "Project root for indexing, sidecars, and default shell cwd",
        },
        cwd: {
          type: "string",
          description: "Working directory for this process. Relative paths resolve under projectDir; artifacts still use projectDir.",
        },
      },
      required: ["language", "code"],
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_execute"),
  },
  {
    name: "ctx_execute_file",
    description:
      "Execute code with a file path. Only printed summary enters context — raw file stays in sandbox.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        language: { type: "string", description: "Runtime language" },
        code: { type: "string", description: "Source code" },
        projectDir: { type: "string", description: "Optional project root override" },
        timeout: { type: "number", description: "Max execution time in ms" },
        intent: { type: "string", description: "What to extract when output is large" },
      },
      required: ["path", "language", "code"],
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_execute_file"),
  },
  {
    name: "ctx_read",
    description:
      "Read files using map, outline, symbols, slice, or full modes. Large full reads require a reason.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        projectDir: { type: "string", description: "Optional project root override" },
        mode: { type: "string", description: "auto | map | outline | slice | symbols | full" },
        start: { type: "number", description: "Start line for slice mode" },
        end: { type: "number", description: "End line for slice mode" },
        reason: { type: "string", description: "Reason for large full reads" },
      },
      required: ["path"],
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_read"),
  },
  {
    name: "ctx_index",
    description: "Store content in the FTS5 knowledge base for later search.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Text to index" },
        path: { type: "string", description: "File path to read and index without loading content into context" },
        source: { type: "string", description: "Descriptive source label" },
        projectDir: { type: "string", description: "Optional project root override" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_index"),
  },
  {
    name: "ctx_search",
    description: "Query indexed content via FTS5. Pass all questions as an array in ONE call.",
    parameters: {
      type: "object",
      properties: {
        queries: { type: "array", items: { type: "string" }, description: "Search queries" },
        limit: { type: "number", description: "Results per query" },
        source: { type: "string", description: "Optional source filter" },
        projectDir: { type: "string", description: "Optional project root override" },
        contentType: { type: "string", description: "code | prose" },
        sort: { type: "string", description: "relevance | timeline" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_search"),
  },
  {
    name: "ctx_fetch_and_index",
    description: "Fetch a URL, chunk it, and index — raw HTML never enters context.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        source: { type: "string", description: "Source label for indexed chunks" },
        requests: {
          type: "array",
          items: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string" },
              source: { type: "string" },
            },
            additionalProperties: true,
          },
          description: "Batch of {url, source} requests",
        },
        concurrency: { type: "number", description: "Max URLs to fetch in parallel" },
        force: { type: "boolean", description: "Skip cache and fetch again" },
        projectDir: { type: "string", description: "Optional project root override" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_fetch_and_index"),
  },
  {
    name: "ctx_fetch_run",
    description: "List or fetch redacted raw-output sidecars created by context-mode runs.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run id or prefix to fetch" },
        projectDir: { type: "string", description: "Optional project root override" },
        latest: { type: "boolean", description: "Fetch latest artifact" },
        list: { type: "boolean", description: "List recent artifacts" },
        raw: { type: "boolean", description: "Include redacted raw preview" },
        pin: { type: "boolean", description: "Pin the artifact so cleanup can preserve it" },
        maxBytes: { type: "number", description: "Max raw preview bytes" },
        limit: { type: "number", description: "Max list entries" },
        preview: { type: "string", description: "head | tail raw preview window" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_fetch_run"),
  },
  {
    name: "ctx_batch_execute",
    description:
      "Run multiple commands and search queries in ONE call. Primary research tool — replaces 30+ individual calls.",
    parameters: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "command"],
            properties: {
              label: { type: "string" },
              command: { type: "string" },
            },
            additionalProperties: true,
          },
          description: "Array of {label, command} objects",
        },
        queries: { type: "array", items: { type: "string" }, description: "Search queries to run after indexing" },
        timeout: { type: "number", description: "Max execution time in ms" },
        concurrency: { type: "number", description: "Max commands to run in parallel, 1-8" },
        projectDir: {
          type: "string",
          description: "Project root for indexing and default shell cwd",
        },
        cwd: {
          type: "string",
          description: "Working directory for batch commands. Relative paths resolve under projectDir; artifacts/indexing still use projectDir.",
        },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_batch_execute"),
  },
  {
    name: "ctx_route",
    description: "Classify a raw command and explain the context-mode routing decision without executing it.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Raw command to classify" },
        explain: { type: "boolean", description: "Return pretty JSON explanation" },
        mode: { type: "string", description: "off | recommend | rewrite" },
        adapterCanRewrite: { type: "boolean", description: "Whether the current adapter can safely mutate tool input" },
      },
      required: ["command"],
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_route"),
  },
  {
    name: "ctx_stats",
    description: "Show context-mode session statistics — token consumption and per-tool breakdown.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "session | lifetime | all" },
        session: { type: "string", description: "Session id to report, or latest" },
        listSessions: { type: "boolean", description: "Return recent sessions instead of the full report" },
        limit: { type: "number", description: "Maximum sessions to list when listSessions is true" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_stats"),
  },
  {
    name: "ctx_gain",
    description: "Summarize current-session context savings from indexed, sandboxed, cached, and sidecar output.",
    parameters: {
      type: "object",
      properties: {
        json: { type: "boolean", description: "Return machine-readable JSON" },
        session: { type: "string", description: "Include persisted telemetry for a session id, or latest" },
        lastDays: { type: "number", description: "Include persisted telemetry across the last N days" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_gain"),
  },
  {
    name: "ctx_discover",
    description: "Report noisy tools, sidecar volume, and bypass categories context-mode can or cannot observe.",
    parameters: {
      type: "object",
      properties: {
        json: { type: "boolean", description: "Return machine-readable JSON" },
        minBytes: { type: "number", description: "Minimum returned bytes for noisy-tool findings" },
        session: { type: "string", description: "Include persisted telemetry for a session id, or latest" },
        lastDays: { type: "number", description: "Include persisted telemetry across the last N days" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_discover"),
  },
  {
    name: "ctx_guard",
    experimental: true,
    description: "Scan output, sidecars, files, and fixtures for secrets, prompt-injection markers, and unsafe terminal controls.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", description: "scan-output | scan-sidecars | scan-file | scan-fixtures" },
        text: { type: "string", description: "Text to scan" },
        json: { type: "boolean", description: "Return machine-readable JSON" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_guard"),
  },
  {
    name: "ctx_eval",
    experimental: true,
    description: "Run deterministic parser, router, redaction, and omission fixtures.",
    parameters: {
      type: "object",
      properties: {
        pack: { type: "string", description: "all | parsers | router | redaction | tool-broker | no-critical-omissions" },
        fast: { type: "boolean", description: "Run fast fixture pack" },
        json: { type: "boolean", description: "Return machine-readable JSON" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_eval"),
  },
  {
    name: "ctx_trace",
    experimental: true,
    description: "Inspect local trace spans, why-big summaries, tool breakdowns, and parser activity.",
    parameters: {
      type: "object",
      properties: {
        latest: { type: "boolean", description: "Use latest session" },
        session: { type: "string", description: "Session id" },
        whyBig: { type: "boolean", description: "Explain large context use" },
        json: { type: "boolean", description: "Return machine-readable JSON" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_trace"),
  },
  {
    name: "ctx_diff",
    experimental: true,
    description: "Summarize Git changes with raw inventory preservation, semantic groups, and risk reason codes.",
    parameters: {
      type: "object",
      properties: {
        semantic: { type: "boolean", description: "Return semantic grouping" },
        risk: { type: "boolean", description: "Return risk summary" },
        rawSidecar: { type: "boolean", description: "Store redacted raw diff sidecar" },
        json: { type: "boolean", description: "Return machine-readable JSON" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_diff"),
  },
  {
    name: "ctx_cache",
    experimental: true,
    description: "Explain task-cache eligibility and explicitly run approved cache-serving canary commands.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", description: "explain | run | list | purge" },
        command: { type: "string", description: "Command to explain" },
        json: { type: "boolean", description: "Return machine-readable JSON" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_cache"),
  },
  {
    name: "ctx_doctor",
    description: "Run context-mode diagnostics — runtimes, hooks, FTS5, plugin registration.",
    parameters: {
      type: "object",
      properties: {
        json: { type: "boolean", description: "Return machine-readable JSON with checks and actions" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_doctor"),
  },
  {
    name: "ctx_upgrade",
    description: "Upgrade context-mode to the latest version.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_upgrade"),
  },
  {
    name: "ctx_purge",
    description:
      "DESTRUCTIVE — permanently delete indexed content. CANNOT be undone.\n\n" +
      "MUST specify exactly ONE scope:\n" +
      "  • {confirm:true, sessionId:\"<uuid>\"}  → wipes ONLY that session's events + chunks; preserves stats and other sessions\n" +
      "  • {confirm:true, scope:\"project\"}      → wipes ENTIRE project: FTS5 KB + every session DB + stats file\n\n" +
      "REFUSED:\n" +
      "  • confirm:false                              → 'purge cancelled'\n" +
      "  • sessionId AND scope:\"project\" together     → 'ambiguous — pick one'\n" +
      "  • scope:\"session\" without sessionId          → throws\n" +
      "  • bare {confirm:true}                        → DEPRECATED: maps to scope:\"project\" with stderr warning\n\n" +
      "Use sessionId for clearing one conversation. Use scope:\"project\" only when the user explicitly resets everything. NEVER call with bare {confirm:true}.",
    parameters: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "Must be true unless dryRun:true is set" },
        dryRun: { type: "boolean", description: "Preview only; do not delete files or rows" },
        sessionId: { type: "string", description: "UUID of a single session to purge" },
        scope: { type: "string", description: "session | project" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_purge"),
  },
  {
    name: "ctx_insight",
    description: "Open the context-mode Insight analytics dashboard in the browser.",
    parameters: {
      type: "object",
      properties: {
        port: { type: "number", description: "Port to serve on" },
        sessionDir: { type: "string", description: "Override INSIGHT_SESSION_DIR" },
        contentDir: { type: "string", description: "Override INSIGHT_CONTENT_DIR" },
        insightSessionDir: { type: "string", description: "Alias for sessionDir" },
        insightContentDir: { type: "string", description: "Alias for contentDir" },
      },
      additionalProperties: true,
    },
    execute: cliRedirect("ctx_insight"),
  },
];

export const OPENCLAW_TOOL_DEFS: readonly OpenClawToolDef[] = OPENCLAW_BRIDGE_TOOL_DEFS.map((tool) => ({
  ...tool,
  description: tool.description.startsWith("Bridge stub; does not execute.")
    ? tool.description
    : `Bridge stub; does not execute. ${tool.description}`,
}));

export function openClawExperimentalToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CTX_MODE_EXPERIMENTAL ?? env.CONTEXT_MODE_EXPERIMENTAL ?? "") === "1";
}

export function getOpenClawToolDefs(env: NodeJS.ProcessEnv = process.env): readonly OpenClawToolDef[] {
  const experimental = openClawExperimentalToolsEnabled(env);
  return OPENCLAW_TOOL_DEFS.filter((def) => !def.experimental || experimental);
}

/** Stable list of tool names — used by tests and manifest validation. */
export const OPENCLAW_TOOL_NAMES: readonly string[] = getOpenClawToolDefs().map(
  (def) => def.name,
);
