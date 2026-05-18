import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { redactCommandShape, stableCommandHash } from "../routing/command-classifier.js";
import { redactArtifactText } from "./redaction.js";

export type RunArtifactStatus = "succeeded" | "failed" | "unknown";

export interface WriteRunArtifactInput {
  readonly projectDir: string;
  readonly command: string;
  readonly sessionId?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly status?: RunArtifactStatus;
  readonly exitCode?: number;
  readonly parser?: string;
  readonly parserConfidence?: number;
  readonly parserConfidenceLevel?: string;
  readonly summary?: string;
  readonly runId?: string;
  readonly now?: Date;
  readonly pin?: boolean;
  readonly maxRunBytes?: number;
  readonly maxProjectBytes?: number;
  readonly ttlDays?: number;
}

export interface RunArtifactMetadata {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sessionId?: string;
  readonly createdAt: string;
  readonly status: RunArtifactStatus;
  readonly exitCode?: number;
  readonly parser?: string;
  readonly parserConfidence?: number;
  readonly parserConfidenceLevel?: string;
  readonly summary?: string;
  readonly commandHash: string;
  readonly commandShape: string;
  readonly rawBytes: number;
  readonly redactedBytes: number;
  readonly storedBytes: number;
  readonly truncated: boolean;
  readonly redactionCounts: Record<string, number>;
  readonly sha256: string;
  readonly pinned: boolean;
  readonly rawPath: string;
  readonly metadataPath: string;
}

export interface RunArtifactRecord {
  readonly metadata: RunArtifactMetadata;
  readonly artifactDir: string;
}

export interface FetchRunOptions {
  readonly projectDir: string;
  readonly runId?: string;
  readonly latest?: boolean;
  readonly maxBytes?: number;
}

export interface FetchedRunArtifact extends RunArtifactRecord {
  readonly raw?: string;
  readonly truncated?: boolean;
}

const DEFAULT_MAX_BYTES = 24_000;
const DEFAULT_MAX_RUN_BYTES = 5 * 1024 * 1024;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function datePart(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function sanitizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "run";
}

function assertInside(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel))) return;
  throw new Error(`artifact path escapes root: ${target}`);
}

export function getRunArtifactRoot(projectDir: string): string {
  const root = resolve(projectDir, ".context-mode", "runs");
  assertInside(resolve(projectDir), root);
  return root;
}

function writeAtomic(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, filePath);
}

function readMetadata(metadataPath: string): RunArtifactRecord | null {
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as RunArtifactMetadata;
    if (metadata.schemaVersion !== 1 || !metadata.runId || !metadata.rawPath) return null;
    if (typeof metadata.createdAt !== "string" || !Number.isFinite(Date.parse(metadata.createdAt))) return null;
    const artifactDir = dirname(metadataPath);
    const rawPath = resolve(metadata.rawPath);
    const safeMetadataPath = resolve(metadataPath);
    assertInside(artifactDir, rawPath);
    assertInside(artifactDir, safeMetadataPath);
    return {
      metadata: {
        ...metadata,
        rawPath,
        metadataPath: safeMetadataPath,
      },
      artifactDir,
    };
  } catch {
    return null;
  }
}

function sliceUtf8Bytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const nextBytes = Buffer.byteLength(char);
    if (bytes + nextBytes > maxBytes) break;
    bytes += nextBytes;
    end += char.length;
  }
  return text.slice(0, end);
}

function deletionCandidates(records: readonly RunArtifactRecord[]): RunArtifactRecord[] {
  return [...records]
    .filter((record) => !record.metadata.pinned)
    .sort((a, b) =>
      a.metadata.createdAt.localeCompare(b.metadata.createdAt)
      || a.metadata.runId.localeCompare(b.metadata.runId)
      || a.artifactDir.localeCompare(b.artifactDir)
    );
}

export function cleanupRunArtifacts(
  projectDir: string,
  opts: { ttlDays?: number; maxProjectBytes?: number; now?: Date; keepRunId?: string } = {},
): { deleted: number; bytesDeleted: number } {
  const now = opts.now ?? new Date();
  let deleted = 0;
  let bytesDeleted = 0;
  const records = listRunArtifacts(projectDir, Number.MAX_SAFE_INTEGER);

  for (const record of deletionCandidates(records).filter((record) => record.metadata.runId !== opts.keepRunId)) {
    if (opts.ttlDays === undefined || opts.ttlDays < 0) continue;
    const ageMs = now.getTime() - new Date(record.metadata.createdAt).getTime();
    if (ageMs <= opts.ttlDays * 24 * 60 * 60 * 1000) continue;
    bytesDeleted += record.metadata.storedBytes ?? record.metadata.redactedBytes ?? 0;
    rmSync(record.artifactDir, { recursive: true, force: true });
    deleted++;
  }

  if (opts.maxProjectBytes !== undefined && opts.maxProjectBytes >= 0) {
    let remaining = listRunArtifacts(projectDir, Number.MAX_SAFE_INTEGER);
    let total = remaining.reduce((sum, record) => sum + (record.metadata.storedBytes ?? record.metadata.redactedBytes ?? 0), 0);
    for (const record of deletionCandidates(remaining).filter((record) => record.metadata.runId !== opts.keepRunId)) {
      if (total <= opts.maxProjectBytes) break;
      const bytes = record.metadata.storedBytes ?? record.metadata.redactedBytes ?? 0;
      rmSync(record.artifactDir, { recursive: true, force: true });
      total -= bytes;
      bytesDeleted += bytes;
      deleted++;
      remaining = remaining.filter((item) => item.metadata.runId !== record.metadata.runId);
    }
  }

  return { deleted, bytesDeleted };
}

export function writeRunArtifact(input: WriteRunArtifactInput): RunArtifactRecord {
  const projectDir = resolve(input.projectDir);
  const root = getRunArtifactRoot(projectDir);
  const now = input.now ?? new Date();
  const runId = input.runId ?? randomUUID();
  const commandShape = redactCommandShape(input.command);
  const slug = sanitizeSlug(commandShape.split(/\s+/).slice(0, 3).join("-"));
  const artifactDir = join(root, datePart(now), `${slug}-${runId.slice(0, 12)}`);
  assertInside(root, artifactDir);
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 });

  const rawInput = [
    input.stdout ?? "",
    input.stderr ? `\n--- stderr ---\n${input.stderr}` : "",
  ].join("");
  const redacted = redactArtifactText(rawInput);
  const maxRunBytes = Math.max(1, input.maxRunBytes ?? DEFAULT_MAX_RUN_BYTES);
  const redactedBytes = Buffer.byteLength(redacted.text);
  const truncated = redactedBytes > maxRunBytes;
  const storedText = truncated
    ? `${sliceUtf8Bytes(redacted.text, maxRunBytes)}\n[context-mode: sidecar truncated at ${maxRunBytes} bytes; original redacted bytes ${redactedBytes}]\n`
    : redacted.text;
  const rawPath = join(artifactDir, "raw.log");
  const metadataPath = join(artifactDir, "metadata.json");
  const metadata: RunArtifactMetadata = {
    schemaVersion: 1,
    runId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    createdAt: now.toISOString(),
    status: input.status ?? "unknown",
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...(input.parser ? { parser: input.parser } : {}),
    ...(input.parserConfidence === undefined ? {} : { parserConfidence: input.parserConfidence }),
    ...(input.parserConfidenceLevel ? { parserConfidenceLevel: input.parserConfidenceLevel } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    commandHash: stableCommandHash(input.command),
    commandShape,
    rawBytes: Buffer.byteLength(rawInput),
    redactedBytes,
    storedBytes: Buffer.byteLength(storedText),
    truncated,
    redactionCounts: redacted.counts,
    sha256: sha256(storedText),
    pinned: input.pin ?? false,
    rawPath,
    metadataPath,
  };

  writeAtomic(rawPath, storedText);
  writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  cleanupRunArtifacts(projectDir, {
    maxProjectBytes: input.maxProjectBytes,
    ttlDays: input.ttlDays,
    now,
    keepRunId: runId,
  });
  return { metadata, artifactDir };
}

export function listRunArtifacts(projectDir: string, limit = 20): RunArtifactRecord[] {
  const root = getRunArtifactRoot(projectDir);
  if (!existsSync(root)) return [];
  const records: RunArtifactRecord[] = [];
  for (const day of readdirSync(root)) {
    const dayDir = join(root, day);
    if (!statSync(dayDir).isDirectory()) continue;
    for (const child of readdirSync(dayDir)) {
      const metadataPath = join(dayDir, child, "metadata.json");
      if (!existsSync(metadataPath)) continue;
      const record = readMetadata(metadataPath);
      if (record) records.push(record);
    }
  }
  return records
    .sort((a, b) =>
      b.metadata.createdAt.localeCompare(a.metadata.createdAt)
      || b.metadata.runId.localeCompare(a.metadata.runId)
      || b.artifactDir.localeCompare(a.artifactDir)
    )
    .slice(0, Math.max(1, limit));
}

export function fetchRunArtifact(options: FetchRunOptions): FetchedRunArtifact | null {
  const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const records = listRunArtifacts(options.projectDir, 200);
  const wantedRunId = options.runId;
  const record = wantedRunId
    ? records.find((item) =>
      item.metadata.runId === wantedRunId
      || item.metadata.runId.startsWith(wantedRunId)
      || basename(item.artifactDir).endsWith(wantedRunId)
    )
    : options.latest
      ? records[0]
      : undefined;
  if (!record) return null;

  if (!existsSync(record.metadata.rawPath)) return null;
  const raw = readFileSync(record.metadata.rawPath, "utf8");
  const rawBytes = Buffer.byteLength(raw);
  const truncated = rawBytes > maxBytes;
  return {
    ...record,
    raw: truncated ? sliceUtf8Bytes(raw, maxBytes) : raw,
    truncated,
  };
}

export function pinRunArtifact(projectDir: string, runId: string): RunArtifactRecord | null {
  const record = fetchRunArtifact({ projectDir, runId, maxBytes: 1 });
  if (!record) return null;
  const metadata = { ...record.metadata, pinned: true };
  writeAtomic(record.metadata.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { metadata, artifactDir: record.artifactDir };
}
