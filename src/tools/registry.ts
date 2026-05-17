/**
 * tools/registry — Register extracted tool definitions against an McpServer.
 *
 * Two responsibilities:
 *   1. Translate from `ToolDefinition` shape to the SDK's `registerTool` call.
 *   2. Automatically wrap every response with `trackResponse(name, ...)` so
 *      individual handlers no longer need to remember to call it (or risk
 *      forgetting on some return paths, as happens today in server.ts where
 *      `trackResponse` is called 10+ times per handler).
 */

import type { ToolContext, ToolDefinition } from "./types.js";

/**
 * Register a single tool definition against the MCP server in `ctx.server`.
 * The handler's return value is passed through `ctx.trackResponse`
 * automatically.
 */
export function registerTool<I = unknown, O = unknown>(ctx: ToolContext, def: ToolDefinition<I, O>): void {
  // `as never` here intentionally bypasses the SDK's per-call generic that
  // ties inputSchema to handler-input type. ToolDefinition keeps `inputSchema`
  // as `unknown` so it can hold any Zod schema without infecting consumers
  // with the SDK's deep generic plumbing. Type-safety inside the handler is
  // enforced by the schema's `.parse()` result at runtime.
  ctx.server.registerTool(
    def.name,
    def.config as never,
    (async (input: unknown) => {
      const out = await def.handler(input as never, ctx);
      return ctx.trackResponse(def.name, out as never);
    }) as never,
  );
}

/** Register an array of tool definitions. */
export function registerTools(ctx: ToolContext, defs: readonly ToolDefinition[]): void {
  for (const def of defs) registerTool(ctx, def);
}
