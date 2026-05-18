import { z } from "zod";

import { ctxRead, type CtxReadMode } from "../read/ctx-read.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface ReadDeps {
  readonly getProjectDir: () => string;
  readonly checkFilePath?: (path: string) => ToolTextResult | null;
}

interface ReadInput {
  readonly path: string;
  readonly mode?: CtxReadMode;
  readonly start?: number;
  readonly end?: number;
  readonly reason?: string;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function makeCtxRead(deps: ReadDeps): ToolDefinition<ReadInput, ToolTextResult> {
  return {
    name: "ctx_read",
    config: {
      title: "Context-Aware File Read",
      description:
        "Read files using map, outline, symbols, slice, or full modes. Large full reads require a reason.",
      inputSchema: z.object({
        path: z.string().min(1).describe("File path, absolute or relative to project root"),
        mode: z.enum(["auto", "map", "outline", "slice", "symbols", "full"]).optional().describe("Read mode"),
        start: z.coerce.number().int().positive().optional().describe("Start line for slice mode"),
        end: z.coerce.number().int().positive().optional().describe("End line for slice mode"),
        reason: z.string().optional().describe("Required for full reads of large files"),
      }),
    },
    handler(input: ReadInput, _ctx: ToolContext): ToolTextResult {
      try {
        const denied = deps.checkFilePath?.(input.path);
        if (denied) return denied;
        const result = ctxRead({ projectDir: deps.getProjectDir(), ...input });
        const suffix = result.truncated ? "\n\n...[slice truncated by max slice line budget]" : "";
        return {
          content: [{
            type: "text",
            text: [
              `ctx_read ${result.mode}: ${result.path}`,
              `lines: ${result.lineCount} bytes: ${result.bytes}`,
              `provider: ${result.provider}`,
              "",
              result.text,
              suffix,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `CTX_READ_FAILED: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  };
}
