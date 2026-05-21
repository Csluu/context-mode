import { z } from "zod";

import { ctxRead, type CtxReadMode } from "../read/ctx-read.js";
import {
  formatReadPolicyError,
  resolveProjectDirForRead,
  resolveReadTargetPath,
} from "../read/read-policy.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface ReadDeps {
  readonly getProjectDir: () => string;
  readonly resolveProjectDirOverride?: (projectDir: string | undefined) => string | undefined;
  readonly checkFilePath?: (path: string, projectDir: string) => ToolTextResult | null;
}

interface ReadInput {
  readonly path: string;
  readonly projectDir?: string;
  readonly mode?: CtxReadMode;
  readonly compact?: boolean;
  readonly start?: number;
  readonly end?: number;
  readonly reason?: string;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function shouldAutoCompactShortSlice(input: ReadInput): boolean {
  if (input.compact !== undefined || input.mode !== "slice") return false;
  const start = input.start ?? 1;
  const end = input.end ?? start;
  return end >= start && end - start + 1 <= 20;
}

export function makeCtxRead(deps: ReadDeps): ToolDefinition<ReadInput, ToolTextResult> {
  return {
    name: "ctx_read",
    config: {
      title: "Context-Aware File Read",
      description:
        "Read files using map, outline, symbols, slice, or full modes. Large full reads require a reason.",
      inputSchema: z.object({
        path: z.string().min(1).describe("File path, absolute or relative to project root"),
        projectDir: z.string().optional().describe("Optional project root override for relative paths. Must satisfy the same projectDir allowlist as execute tools."),
        mode: z.enum(["auto", "map", "outline", "slice", "symbols", "full"]).optional().describe("Read mode"),
        compact: z.boolean().optional().describe("Return terser map/outline/symbols/slice output with stable line numbers and reduced headers."),
        start: z.coerce.number().int().positive().optional().describe("Start line for slice mode"),
        end: z.coerce.number().int().positive().optional().describe("End line for slice mode"),
        reason: z.string().optional().describe("Required for full reads of large files"),
      }),
    },
    handler(input: ReadInput, _ctx: ToolContext): ToolTextResult {
      try {
        const projectDir = resolveProjectDirForRead(
          input,
          deps.getProjectDir(),
          deps.resolveProjectDirOverride,
        );
        const resolvedPath = resolveReadTargetPath(input.path, projectDir);
        const denied = deps.checkFilePath?.(resolvedPath, projectDir);
        if (denied) return denied;
        const effectiveCompact = input.compact ?? shouldAutoCompactShortSlice(input);
        const result = ctxRead({ ...input, compact: effectiveCompact, path: resolvedPath, projectDir });
        const suffix = result.truncated ? "\n\n...[slice truncated by max slice line budget]" : "";
        const compactMode = effectiveCompact && ["map", "outline", "symbols", "slice"].includes(result.mode);
        if (compactMode) {
          // Compact renderers in ctxRead already emit their own header (mode tag,
          // provider/confidence, lines/bytes counters). Skip the wrapper header
          // here to avoid duplicating ~3 lines of metadata on every tiny call.
          return {
            content: [{
              type: "text",
              text: [result.text, suffix].filter(Boolean).join("\n"),
            }],
          };
        }
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
          content: [{ type: "text", text: formatReadPolicyError(err) }],
          isError: true,
        };
      }
    },
  };
}
