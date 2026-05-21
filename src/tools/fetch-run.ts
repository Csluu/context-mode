import { z } from "zod";
import { relative } from "node:path";

import { getAdapterOutputBudget } from "../adapters/output-budget.js";
import { fetchRunArtifact, listRunArtifacts, pinRunArtifact } from "../artifacts/run-store.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface FetchRunDeps {
  readonly getProjectDir: () => string;
  readonly resolveProjectDirOverride?: (projectDir: string | undefined) => string | undefined;
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
  readonly preview?: "head" | "tail";
  readonly query?: string;
  readonly contextLines?: number;
  readonly maxMatches?: number;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function displayPath(projectDir: string, rawPath: string): string {
  const rel = relative(projectDir, rawPath).replace(/\\/g, "/");
  return rel && !rel.startsWith("..") ? rel : "<redacted-local-path>";
}

function renderList(projectDir: string, limit: number): string {
  const records = listRunArtifacts(projectDir, limit);
  if (records.length === 0) {
    return `No run artifacts found for project: ${projectDir}`;
  }
  return [
    `Run artifacts (${records.length}):`,
    `project: ${projectDir}`,
    "",
    ...records.map((record) => {
      const m = record.metadata;
      const pin = m.pinned ? " pinned" : "";
      return `- ${m.runId} ${m.status}${pin} ${m.redactedBytes}B ${m.createdAt} ${m.commandShape}`;
    }),
  ].join("\n");
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function clipUtf8(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const next = byteLength(char);
    if (bytes + next > maxBytes) break;
    bytes += next;
    end += char.length;
  }
  return text.slice(0, end);
}

function renderQueryMatches(args: {
  readonly raw: string;
  readonly query: string;
  readonly maxBytes: number;
  readonly contextLines: number;
  readonly maxMatches: number;
}): { text: string; matchCount: number; emittedMatches: number; truncated: boolean } {
  const needle = args.query.trim().toLowerCase();
  if (!needle) {
    return { text: "query was empty", matchCount: 0, emittedMatches: 0, truncated: false };
  }

  const lines = args.raw.split(/\r?\n/);
  const matchIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) matchIndexes.push(i);
  }

  const ranges: Array<{ start: number; end: number; matchIndexes: number[] }> = [];
  for (const idx of matchIndexes.slice(0, args.maxMatches)) {
    const start = Math.max(0, idx - args.contextLines);
    const end = Math.min(lines.length - 1, idx + args.contextLines);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      last.matchIndexes.push(idx);
    } else {
      ranges.push({ start, end, matchIndexes: [idx] });
    }
  }

  const out: string[] = [];
  let emittedMatches = 0;
  let truncated = false;
  for (const range of ranges) {
    const blockLines: string[] = [];
    if (out.length > 0) blockLines.push("--");
    for (let i = range.start; i <= range.end; i++) {
      blockLines.push(`${i + 1}: ${lines[i]}`);
    }
    const block = `${blockLines.join("\n")}\n`;
    if (byteLength(out.join("\n") + block) > args.maxBytes) {
      truncated = true;
      break;
    }
    out.push(block.trimEnd());
    emittedMatches += range.matchIndexes.length;
  }

  if (matchIndexes.length > args.maxMatches) truncated = true;
  if (out.length === 0 && matchIndexes.length > 0) {
    truncated = true;
    const first = `${matchIndexes[0] + 1}: ${lines[matchIndexes[0]]}`;
    out.push(clipUtf8(first, args.maxBytes));
    emittedMatches = 1;
  }
  return {
    text: out.join("\n"),
    matchCount: matchIndexes.length,
    emittedMatches,
    truncated,
  };
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
        preview: z.enum(["head", "tail"]).optional().describe("Raw preview window. Use tail for final test/build summaries at the end of long logs."),
        query: z.string().optional().describe("Return compact matching excerpts from redacted raw output instead of a broad preview."),
        contextLines: z.coerce.number().int().min(0).max(5).optional().describe("Context lines around each query match, default 1."),
        maxMatches: z.coerce.number().int().positive().max(50).optional().describe("Maximum query matches to emit, default 8."),
      }),
    },
    handler(input: FetchRunInput, ctx: ToolContext): ToolTextResult {
      let projectDir: string;
      try {
        projectDir = input.projectDir?.trim()
          ? deps.resolveProjectDirOverride?.(input.projectDir) ?? input.projectDir.trim()
          : deps.getProjectDir();
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
      const budget = getAdapterOutputBudget(ctx.getAdapterId?.() ?? "unknown");
      if (input.list || (!input.runId && !input.latest)) {
        return { content: [{ type: "text", text: renderList(projectDir, input.limit ?? 20) }] };
      }

      let artifact = fetchRunArtifact({
        projectDir,
        runId: input.runId,
        latest: input.latest || !input.runId,
        maxBytes: input.maxBytes ?? budget.maxSidecarPreviewBytes,
        preview: input.preview,
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
            preview: input.preview,
          }) ?? artifact;
        }
      }

      const m = artifact.metadata;
      const lines = [
        `Run artifact ${m.runId}`,
        `project: ${projectDir}`,
        `status: ${m.status}${m.exitCode === undefined ? "" : ` exit=${m.exitCode}`}`,
        `created: ${m.createdAt}`,
        `command: ${m.commandShape}`,
        `bytes: raw ${m.rawBytes}, redacted ${m.redactedBytes}`,
        `path: ${displayPath(projectDir, m.rawPath)}`,
      ];
      if (m.summary) lines.push(`summary: ${m.summary}`);
      if (m.pinned) lines.push("pinned: true");
      if (input.query?.trim()) {
        const queryBudget = input.maxBytes ?? Math.min(budget.maxSidecarPreviewBytes, 12_000);
        const fullArtifact = artifact.raw && !artifact.truncated
          ? artifact
          : fetchRunArtifact({
            projectDir,
            runId: artifact.metadata.runId,
            maxBytes: Math.max(1, Math.min(5 * 1024 * 1024, artifact.metadata.storedBytes)),
          }) ?? artifact;
        const matches = renderQueryMatches({
          raw: fullArtifact.raw ?? "",
          query: input.query,
          maxBytes: queryBudget,
          contextLines: input.contextLines ?? 1,
          maxMatches: input.maxMatches ?? 8,
        });
        lines.push(
          "",
          `--- redacted raw matches: ${JSON.stringify(input.query.trim())} (${matches.emittedMatches}/${matches.matchCount}) ---`,
          matches.text || "No matches found.",
        );
        if (matches.truncated) {
          lines.push("", `...[match excerpt truncated at ${queryBudget} bytes or ${input.maxMatches ?? 8} matches]`);
        }
      } else if (input.raw) {
        const preview = input.preview ?? "head";
        lines.push(
          "",
          artifact.truncated ? `--- redacted raw preview (${preview}) ---` : "--- redacted raw ---",
          artifact.raw ?? "",
        );
        if (artifact.truncated) {
          lines.push("", `...[${preview} preview truncated at ${input.maxBytes ?? budget.maxSidecarPreviewBytes} bytes]`);
        }
      } else {
        lines.push("", "Use ctx_fetch_run({ runId, query: \"...\" }) for compact excerpts or raw: true for redacted raw preview.");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  };
}
