import { z } from "zod";

import { routeCommand, type RouteCommandOptions } from "../routing/rewrite-registry.js";
import type { RouteDecision } from "../routing/types.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface RouteInput extends RouteCommandOptions {
  command: string;
  explain?: boolean;
}

interface RouteDeps {
  readonly onDecision?: (event: { command: string; decision: RouteDecision }) => void;
}

export function makeCtxRoute(deps: RouteDeps = {}): ToolDefinition<RouteInput, { content: Array<{ type: "text"; text: string }> }> {
  return {
    name: "ctx_route",
    config: {
      title: "Explain Command Routing",
      description:
        "Classify a raw command and explain the context-mode routing decision without executing or mutating it.",
      inputSchema: z.object({
        command: z.string().min(1).describe("Raw command to classify"),
        explain: z.boolean().optional().default(true).describe("Return pretty JSON explanation"),
        mode: z.enum(["off", "recommend", "rewrite"]).optional().describe("Router mode to simulate"),
        adapterCanRewrite: z.boolean().optional().describe("Whether the current adapter can safely mutate tool input"),
      }),
    },
    handler(input: RouteInput, _ctx: ToolContext) {
      const opts: RouteCommandOptions = {
        mode: input.mode,
        adapterCanRewrite: input.adapterCanRewrite,
      };
      const decision = routeCommand(input.command, opts);
      deps.onDecision?.({ command: input.command, decision });
      const text = input.explain === false
        ? JSON.stringify(decision)
        : JSON.stringify(decision, null, 2);
      return { content: [{ type: "text", text }] };
    },
  };
}
