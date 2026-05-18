import { z } from "zod";

import { explainTaskCache, renderCacheExplain } from "../cache/explain.js";
import { listTaskCacheEntries, purgeTaskCache, renderTaskCacheList, runTaskCached } from "../cache/run.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface CacheDeps {
  readonly getProjectDir: () => string;
}

interface CacheInput {
  readonly mode?: "explain" | "run" | "list" | "purge";
  readonly command?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function makeCtxCache(deps: CacheDeps): ToolDefinition<CacheInput, ToolTextResult> {
  return {
    name: "ctx_cache",
    experimental: true,
    config: {
      title: "Task Cache Explain",
      description:
        "Explain or explicitly run deterministic task-cache entries. Hit serving is limited to approved canary command families.",
      inputSchema: z.object({
        mode: z.enum(["explain", "run", "list", "purge"]).optional().default("explain"),
        command: z.string().optional().describe("Command to explain"),
        json: z.boolean().optional().describe("Return JSON"),
        dryRun: z.boolean().optional().describe("Preview purge only"),
      }),
    },
    handler(input: CacheInput, _ctx: ToolContext): ToolTextResult {
      const mode = input.mode ?? "explain";
      const projectDir = deps.getProjectDir();
      if (mode === "list") {
        const entries = listTaskCacheEntries(projectDir);
        const payload = { schemaVersion: 1, servingEnabled: true, entries: entries.map((row) => ({ path: row.path, ...row.entry })) };
        return { content: [{ type: "text", text: input.json ? JSON.stringify(payload, null, 2) : renderTaskCacheList(projectDir) }] };
      }
      if (mode === "purge") {
        const dryRun = input.dryRun ?? true;
        const purged = purgeTaskCache(projectDir, dryRun);
        const payload = { schemaVersion: 1, servingEnabled: true, dryRun, ...purged };
        return {
          content: [{
            type: "text",
            text: input.json ? JSON.stringify(payload, null, 2) : `ctx_cache purge: ${dryRun ? "would delete" : "deleted"} ${purged.entries} entr${purged.entries === 1 ? "y" : "ies"} (${purged.bytes}B)`,
          }],
        };
      }
      if (!input.command) {
        return { content: [{ type: "text", text: `CTX_CACHE_COMMAND_REQUIRED: pass command for mode=${mode}` }], isError: true };
      }
      if (mode === "run") {
        const result = runTaskCached({ command: input.command, cwd: projectDir });
        const payload = {
          ...result,
          stdout: undefined,
          stderr: undefined,
          stdoutBytes: Buffer.byteLength(result.stdout),
          stderrBytes: Buffer.byteLength(result.stderr),
        };
        if (input.json) {
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: result.exitCode !== 0 };
        }
        return {
          content: [{
            type: "text",
            text: [
              `ctx_cache ${result.status} exit=${result.exitCode}`,
              `family: ${result.explain.commandFamily}`,
              `command: ${result.explain.commandShape}`,
              `reasons: ${result.reasonCodes.join(", ")}`,
              ...(result.cachePath ? [`cache: ${result.cachePath}`] : []),
            ].join("\n"),
          }],
          isError: result.exitCode !== 0,
        };
      }
      const result = explainTaskCache({ command: input.command, cwd: projectDir });
      return {
        content: [{ type: "text", text: input.json ? JSON.stringify(result, null, 2) : renderCacheExplain(result) }],
      };
    },
  };
}
