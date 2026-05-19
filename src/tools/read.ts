import { existsSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

import { ctxRead, type CtxReadMode } from "../read/ctx-read.js";
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
  readonly start?: number;
  readonly end?: number;
  readonly reason?: string;
}

type ToolTextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function canonicalExistingDir(dir: string): string | null {
  try {
    if (!existsSync(dir)) return null;
    return realpathSync(resolve(dir));
  } catch {
    return null;
  }
}

function isInsideOrSame(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function splitAllowedRoots(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(delimiter)
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);
}

function defaultExternalReadRoots(): string[] {
  const home = homedir();
  return [
    resolve(home, ".codex", "skills"),
    resolve(home, ".agents", "skills"),
  ];
}

function allowedExternalReadRoot(filePath: string): string | null {
  const target = existsSync(filePath) ? realpathSync(filePath) : resolve(filePath);
  for (const root of [
    ...defaultExternalReadRoots(),
    ...splitAllowedRoots(process.env.CONTEXT_MODE_ALLOWED_READ_DIRS),
  ]) {
    const canonicalRoot = canonicalExistingDir(root);
    if (canonicalRoot && isInsideOrSame(canonicalRoot, target)) return canonicalRoot;
  }
  return null;
}

function normalizePathForCurrentPlatform(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (process.platform !== "win32") return trimmed;
  const normalized = trimmed.replace(/\\/g, "/");
  const match = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(normalized);
  if (!match) return trimmed;
  const rest = match[2] ? match[2].replace(/\//g, "\\") : "";
  return `${match[1].toUpperCase()}:\\${rest}`;
}

function isAbsoluteForCurrentPlatform(inputPath: string): boolean {
  if (isAbsolute(inputPath)) return true;
  return process.platform === "win32" && /^\/[a-zA-Z](?:\/|$)/.test(inputPath.replace(/\\/g, "/"));
}

function resolveProjectDirForRead(
  input: ReadInput,
  defaultProjectDir: string,
  resolveOverride?: (projectDir: string | undefined) => string | undefined,
): string {
  if (input.projectDir?.trim()) {
    return resolveOverride?.(input.projectDir) ?? resolve(input.projectDir);
  }
  if (isAbsoluteForCurrentPlatform(input.path)) {
    const normalizedPath = normalizePathForCurrentPlatform(input.path);
    const projectRoot = canonicalExistingDir(defaultProjectDir) ?? resolve(defaultProjectDir);
    const target = existsSync(normalizedPath) ? realpathSync(normalizedPath) : resolve(normalizedPath);
    if (isInsideOrSame(projectRoot, target)) return projectRoot;
    const externalRoot = allowedExternalReadRoot(normalizedPath);
    if (externalRoot) return externalRoot;
    throw new Error(
      `CTX_READ_ABSOLUTE_PATH_OUTSIDE_PROJECT: ${target} is outside projectDir (${projectRoot}). ` +
      "Pass projectDir for a validated project override or add a containing directory to CONTEXT_MODE_ALLOWED_READ_DIRS.",
    );
  }
  return defaultProjectDir;
}

function formatReadError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("file path escapes project root")) {
    return [
      `CTX_READ_FAILED: ${message}`,
      "Hint: for non-project docs or skill files, omit projectDir so ctx_read can infer a readable root from the absolute path, or use ctx_index(path) followed by ctx_search.",
    ].join("\n");
  }
  return `CTX_READ_FAILED: ${message}`;
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
        const effectivePath = isAbsoluteForCurrentPlatform(input.path)
          ? normalizePathForCurrentPlatform(input.path)
          : input.path;
        const resolvedPath = isAbsoluteForCurrentPlatform(effectivePath)
          ? resolve(effectivePath)
          : resolve(projectDir, input.path);
        const denied = deps.checkFilePath?.(resolvedPath, projectDir);
        if (denied) return denied;
        const result = ctxRead({ ...input, path: resolvedPath, projectDir });
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
          content: [{ type: "text", text: formatReadError(err) }],
          isError: true,
        };
      }
    },
  };
}
