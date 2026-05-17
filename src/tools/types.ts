/**
 * tools/types — Shared types for extracted MCP tool handlers.
 *
 * Foundation for splitting src/server.ts (4006 LOC god module). Each tool
 * moves from an inline `server.registerTool(...)` call to its own file
 * that exports a `ToolDefinition`. server.ts retains bootstrap + the
 * registration call site.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Context object passed to every extracted tool handler. Carries the
 * dependencies tool handlers commonly need without forcing each one to
 * reach into module-level state in server.ts.
 *
 * Keep this surface narrow — only add fields used by 2+ tools. Single-use
 * deps stay inline.
 */
export interface ToolContext {
  /** The McpServer instance (rare — only for handlers that need server.server.getClientVersion etc.). */
  readonly server: McpServer;
  /** Absolute path to the plugin install root (where package.json lives). */
  readonly pluginRoot: string;
  /** Resolve the active session directory. */
  readonly getSessionDir: () => string;
  /** Wrap a tool response with usage tracking. Returns the response unchanged. */
  readonly trackResponse: <T>(toolName: string, response: T) => T;
}

/**
 * A self-contained tool definition. The `config` shape matches
 * `McpServer.registerTool`'s second argument exactly so we can pass it
 * through without translation.
 */
export interface ToolDefinition<I = unknown, O = unknown> {
  readonly name: string;
  readonly config: {
    readonly title: string;
    readonly description: string;
    readonly inputSchema: unknown;
  };
  /**
   * Tool implementation. Receives the parsed input AND the ToolContext.
   * Should return the raw response object — the registry wraps it with
   * `trackResponse` automatically.
   */
  readonly handler: (input: I, ctx: ToolContext) => Promise<O> | O;
}
