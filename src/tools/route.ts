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

const TINY_DIRECT_PATTERNS = [
  /^\s*echo\s+.{0,80}$/i,
  /^\s*pwd\s*$/i,
  /^\s*(?:whoami|hostname)\s*$/i,
  /^\s*(?:node|npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.cmd)?)\s+(?:--version|-v)\s*$/i,
  /^\s*(?:python(?:3)?|python(?:\.exe)?)\s+--version\s*$/i,
  /^\s*git\s+(?:--version|version)\s*$/i,
  /^\s*git\s+branch\s+--show-current\s*$/i,
  /^\s*git\s+rev-parse\s+(?:--abbrev-ref\s+HEAD|--show-toplevel)\s*$/i,
];

function isTinyDirectCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length > 120 || /[\r\n|&;<>`$]/.test(trimmed)) return false;
  return TINY_DIRECT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function renderRouteDecision(command: string, decision: RouteDecision, explain: boolean | undefined): string {
  if (decision.decision === "pass-through" && !decision.selectedRule && !decision.route && isTinyDirectCommand(command)) {
    return "native-ok: tiny output; use native directly";
  }
  return explain === false
    ? JSON.stringify(decision)
    : JSON.stringify(decision, null, 2);
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
        explain: z.boolean().optional().default(true).describe("Return pretty JSON explanation. Pass-through tiny commands return one compact text line."),
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
      const text = renderRouteDecision(input.command, decision, input.explain);
      return { content: [{ type: "text", text }] };
    },
  };
}
