import { existsSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import { homedir } from "node:os";

export interface ReadPolicyInput {
  readonly path: string;
  readonly projectDir?: string;
}

export function canonicalExistingDir(dir: string): string | null {
  try {
    if (!existsSync(dir)) return null;
    return realpathSync(resolve(dir));
  } catch {
    return null;
  }
}

export function isInsideOrSame(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function splitAllowedRoots(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(delimiter)
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function defaultExternalReadRoots(): string[] {
  const home = homedir();
  return [
    resolve(home, ".codex", "skills"),
    resolve(home, ".agents", "skills"),
  ];
}

export function allowedExternalReadRoot(filePath: string): string | null {
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

export function normalizePathForCurrentPlatform(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (process.platform === "win32" && /^[A-Za-z]:(?![\\/])/.test(trimmed)) {
    throw new Error(`Windows path appears drive-relative or unescaped: ${trimmed}. Use C:\\\\path or C:/path.`);
  }
  if (process.platform !== "win32") return trimmed;
  const normalized = trimmed.replace(/\\/g, "/");
  const match = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(normalized);
  if (!match) return trimmed;
  const rest = match[2] ? match[2].replace(/\//g, "\\") : "";
  return `${match[1].toUpperCase()}:\\${rest}`;
}

export function isAbsoluteForCurrentPlatform(inputPath: string): boolean {
  if (isAbsolute(inputPath)) return true;
  return process.platform === "win32" && /^\/[a-zA-Z](?:\/|$)/.test(inputPath.replace(/\\/g, "/"));
}

export function resolveProjectDirForRead(
  input: ReadPolicyInput,
  defaultProjectDir: string,
  resolveOverride?: (projectDir: string | undefined) => string | undefined,
): string {
  const normalizedInputPath = normalizePathForCurrentPlatform(input.path);
  if (input.projectDir?.trim()) {
    return resolveOverride?.(input.projectDir) ?? resolve(input.projectDir);
  }
  if (isAbsoluteForCurrentPlatform(normalizedInputPath)) {
    const normalizedPath = normalizePathForCurrentPlatform(normalizedInputPath);
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

export function resolveReadTargetPath(inputPath: string, projectDir: string): string {
  const normalizedInputPath = normalizePathForCurrentPlatform(inputPath);
  const effectivePath = isAbsoluteForCurrentPlatform(normalizedInputPath)
    ? normalizePathForCurrentPlatform(normalizedInputPath)
    : normalizedInputPath;
  return isAbsoluteForCurrentPlatform(effectivePath)
    ? resolve(effectivePath)
    : resolve(projectDir, inputPath);
}

export function formatReadPolicyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("file path escapes project root")) {
    return [
      `CTX_READ_FAILED: ${message}`,
      "Hint: for non-project docs or skill files, omit projectDir so ctx_read can infer a readable root from the absolute path, or use ctx_index(path) followed by ctx_search.",
    ].join("\n");
  }
  return `CTX_READ_FAILED: ${message}`;
}
