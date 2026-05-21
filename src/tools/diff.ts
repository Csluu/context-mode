import { z } from "zod";

import { writeRunArtifact } from "../artifacts/run-store.js";
import { collectGitTextDiff, renderDiffSummary, renderDiffCompact, renderDiffRiskFocus } from "../diff/git-text.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface DiffDeps {
  readonly getProjectDir: () => string;
  readonly resolveProjectDirOverride?: (projectDir: string | undefined) => string | undefined;
}

interface DiffInput {
  readonly projectDir?: string;
  readonly semantic?: boolean;
  readonly summary?: boolean;
  readonly risk?: boolean;
  readonly rawSidecar?: boolean;
  readonly staged?: boolean;
  readonly from?: string;
  readonly to?: string;
  readonly json?: boolean;
  readonly maxInputBytes?: number;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function resolveDiffProjectDir(input: DiffInput, deps: DiffDeps): string {
  return input.projectDir?.trim()
    ? deps.resolveProjectDirOverride?.(input.projectDir) ?? input.projectDir.trim()
    : deps.getProjectDir();
}

function renderGitDiffCommand(input: DiffInput): string {
  if (input.staged) return "git diff --cached";
  const refs = [input.from?.trim(), input.to?.trim()].filter((ref): ref is string => Boolean(ref));
  return ["git diff", ...refs].join(" ");
}

export function makeCtxDiff(deps: DiffDeps): ToolDefinition<DiffInput, ToolTextResult> {
  return {
    name: "ctx_diff",
    config: {
      title: "Semantic Diff Summary",
      description:
        "Summarize Git changes with canonical raw Git file inventory, semantic groups, and risk reason codes. Raw Git diff remains source of truth.",
      inputSchema: z.object({
        projectDir: z.string().optional().describe("Optional project root override. Must satisfy the same projectDir allowlist as execute tools."),
        semantic: z.boolean().optional().describe("Attempt provider-backed semantic diff; semantic groups are always returned and raw provider output is omitted from MCP payload"),
        summary: z.boolean().optional().describe("Return compact summary"),
        risk: z.boolean().optional().describe("Emphasize risk reason codes"),
        rawSidecar: z.boolean().optional().describe("Store redacted raw diff sidecar"),
        staged: z.boolean().optional().describe("Inspect staged changes"),
        from: z.string().optional().describe("Optional base Git revision for ref-to-ref or ref-to-worktree diff"),
        to: z.string().optional().describe("Optional target Git revision. Requires from."),
        json: z.boolean().optional().describe("Return JSON"),
        maxInputBytes: z.coerce.number().int().positive().max(20 * 1024 * 1024).optional().describe("Max Git output bytes"),
      }),
    },
    handler(input: DiffInput, _ctx: ToolContext): ToolTextResult {
      let projectDir: string;
      try {
        projectDir = resolveDiffProjectDir(input, deps);
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
      const result = collectGitTextDiff({
        repoDir: projectDir,
        staged: input.staged,
        from: input.from,
        to: input.to,
        includeRaw: input.rawSidecar,
        semantic: input.semantic,
        maxInputBytes: input.maxInputBytes,
      });
      let sidecarPath: string | undefined;
      if (input.rawSidecar && result.rawDiff !== undefined) {
        const artifact = writeRunArtifact({
          projectDir,
          command: renderGitDiffCommand(input),
          sessionId: _ctx.getCurrentSessionId?.(),
          stdout: result.rawDiff,
          status: result.provider.status === "ok" ? "succeeded" : "failed",
          parser: "ctx-diff",
          summary: result.risk.summary,
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
      const rendered = input.risk
        ? renderDiffRiskFocus(result)
        : input.summary
          ? renderDiffCompact(result)
          : renderDiffSummary(result);
      const lines = [rendered];
      if (sidecarPath) lines.push("", `Full raw diff sidecar: ${sidecarPath}`);
      return { content: [{ type: "text", text: lines.join("\n") }], isError: result.provider.status === "failed" };
    },
  };
}
