import { z } from "zod";

import { writeRunArtifact } from "../artifacts/run-store.js";
import { collectGitTextDiff, renderDiffSummary } from "../diff/git-text.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface DiffDeps {
  readonly getProjectDir: () => string;
}

interface DiffInput {
  readonly semantic?: boolean;
  readonly summary?: boolean;
  readonly risk?: boolean;
  readonly rawSidecar?: boolean;
  readonly staged?: boolean;
  readonly json?: boolean;
  readonly maxInputBytes?: number;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function makeCtxDiff(deps: DiffDeps): ToolDefinition<DiffInput, ToolTextResult> {
  return {
    name: "ctx_diff",
    experimental: true,
    config: {
      title: "Semantic Diff Summary",
      description:
        "Summarize Git changes with canonical raw Git file inventory, semantic groups, and risk reason codes. Raw Git diff remains source of truth.",
      inputSchema: z.object({
        semantic: z.boolean().optional().describe("Return semantic groups"),
        summary: z.boolean().optional().describe("Return compact summary"),
        risk: z.boolean().optional().describe("Emphasize risk reason codes"),
        rawSidecar: z.boolean().optional().describe("Store redacted raw diff sidecar"),
        staged: z.boolean().optional().describe("Inspect staged changes"),
        json: z.boolean().optional().describe("Return JSON"),
        maxInputBytes: z.coerce.number().int().positive().max(20 * 1024 * 1024).optional().describe("Max Git output bytes"),
      }),
    },
    handler(input: DiffInput, _ctx: ToolContext): ToolTextResult {
      const projectDir = deps.getProjectDir();
      const result = collectGitTextDiff({
        repoDir: projectDir,
        staged: input.staged,
        includeRaw: input.rawSidecar,
        semantic: input.semantic,
        maxInputBytes: input.maxInputBytes,
      });
      let sidecarPath: string | undefined;
      if (input.rawSidecar && result.rawDiff !== undefined) {
        const artifact = writeRunArtifact({
          projectDir,
          command: input.staged ? "git diff --cached" : "git diff",
          stdout: result.rawDiff,
          status: result.provider.status === "ok" ? "succeeded" : "failed",
          parser: "ctx-diff",
          summary: result.risk.summary,
          pin: true,
        });
        sidecarPath = artifact.metadata.rawPath;
      }
      const payload = {
        ...result,
        semanticDiff: undefined,
        rawDiff: undefined,
        sidecarPath,
      };
      if (input.json) {
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: result.provider.status === "failed" };
      }
      const lines = [renderDiffSummary(result)];
      if (sidecarPath) lines.push("", `Full raw diff sidecar: ${sidecarPath}`);
      return { content: [{ type: "text", text: lines.join("\n") }], isError: result.provider.status === "failed" };
    },
  };
}
