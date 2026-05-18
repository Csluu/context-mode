import { z } from "zod";
import { relative } from "node:path";

import { getAdapterOutputBudget } from "../adapters/output-budget.js";
import { fetchRunArtifact, listRunArtifacts, pinRunArtifact } from "../artifacts/run-store.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface FetchRunDeps {
  readonly getProjectDir: () => string;
}

interface FetchRunInput {
  readonly runId?: string;
  readonly projectDir?: string;
  readonly latest?: boolean;
  readonly list?: boolean;
  readonly raw?: boolean;
  readonly pin?: boolean;
  readonly maxBytes?: number;
  readonly limit?: number;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function displayPath(projectDir: string, rawPath: string): string {
  const rel = relative(projectDir, rawPath).replace(/\\/g, "/");
  return rel && !rel.startsWith("..") ? rel : "<redacted-local-path>";
}

function renderList(projectDir: string, limit: number): string {
  const records = listRunArtifacts(projectDir, limit);
  if (records.length === 0) {
    return "No run artifacts found.";
  }
  return [
    `Run artifacts (${records.length}):`,
    "",
    ...records.map((record) => {
      const m = record.metadata;
      const pin = m.pinned ? " pinned" : "";
      return `- ${m.runId} ${m.status}${pin} ${m.redactedBytes}B ${m.createdAt} ${m.commandShape}`;
    }),
  ].join("\n");
}

export function makeCtxFetchRun(deps: FetchRunDeps): ToolDefinition<FetchRunInput, ToolTextResult> {
  return {
    name: "ctx_fetch_run",
    config: {
      title: "Fetch Run Artifact",
      description:
        "List or fetch redacted raw-output sidecars created by context-mode runs. Raw secrets are not persisted by default.",
      inputSchema: z.object({
        runId: z.string().optional().describe("Run id to fetch. Prefix ids are accepted."),
        projectDir: z.string().optional().describe("Optional project root override for run artifacts."),
        latest: z.boolean().optional().describe("Fetch the latest run artifact."),
        list: z.boolean().optional().describe("List recent run artifacts instead of fetching one."),
        raw: z.boolean().optional().describe("Include redacted raw output preview."),
        pin: z.boolean().optional().describe("Pin the artifact so future cleanup can preserve it."),
        maxBytes: z.coerce.number().int().positive().max(200_000).optional().describe("Max raw preview bytes."),
        limit: z.coerce.number().int().positive().max(100).optional().describe("Max list entries."),
      }),
    },
    handler(input: FetchRunInput, ctx: ToolContext): ToolTextResult {
      const projectDir = input.projectDir?.trim() || deps.getProjectDir();
      const budget = getAdapterOutputBudget(ctx.getAdapterId?.() ?? "unknown");
      if (input.list || (!input.runId && !input.latest)) {
        return { content: [{ type: "text", text: renderList(projectDir, input.limit ?? 20) }] };
      }

      let artifact = fetchRunArtifact({
        projectDir,
        runId: input.runId,
        latest: input.latest || !input.runId,
        maxBytes: input.maxBytes ?? budget.maxSidecarPreviewBytes,
      });
      if (!artifact) {
        return {
          content: [{ type: "text", text: "CTX_ARTIFACT_NOT_FOUND: no run artifact matched the request" }],
          isError: true,
        };
      }
      if (input.pin) {
        const pinned = pinRunArtifact(projectDir, artifact.metadata.runId);
        if (pinned) {
          artifact = fetchRunArtifact({
            projectDir,
            runId: pinned.metadata.runId,
            maxBytes: input.maxBytes ?? budget.maxSidecarPreviewBytes,
          }) ?? artifact;
        }
      }

      const m = artifact.metadata;
      const lines = [
        `Run artifact ${m.runId}`,
        `status: ${m.status}${m.exitCode === undefined ? "" : ` exit=${m.exitCode}`}`,
        `created: ${m.createdAt}`,
        `command: ${m.commandShape}`,
        `bytes: raw ${m.rawBytes}, redacted ${m.redactedBytes}`,
        `path: ${displayPath(projectDir, m.rawPath)}`,
      ];
      if (m.summary) lines.push(`summary: ${m.summary}`);
      if (m.pinned) lines.push("pinned: true");
      if (input.raw) {
        lines.push("", "--- redacted raw preview ---", artifact.raw ?? "");
        if (artifact.truncated) {
          lines.push("", `...[truncated at ${input.maxBytes ?? budget.maxSidecarPreviewBytes} bytes]`);
        }
      } else {
        lines.push("", "Use ctx_fetch_run({ runId, raw: true }) for redacted raw preview.");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  };
}
