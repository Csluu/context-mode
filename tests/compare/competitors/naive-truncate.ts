// Naive truncation baseline — runs commands raw, then truncates output to
// first N lines + last M lines (default: 100/50). Free compression with zero
// intelligence. Settles "is smart compression worth the install cost?"
//
// Tunable via env: NAIVE_HEAD_LINES, NAIVE_TAIL_LINES.

import { readFileSync, statSync } from "node:fs";
import {
  type CompetitorAdapter,
  type CompetitorRunResult,
  type FetchUrlOpts,
  type IndexOpts,
  type ReadFileOpts,
  type RunCommandOpts,
  type SearchOpts,
  estimateTokens,
  runViaBash,
} from "./lib.js";
import { rawAdapter } from "./raw.js";

const HEAD = Math.max(0, Number(process.env.NAIVE_HEAD_LINES ?? "100"));
const TAIL = Math.max(0, Number(process.env.NAIVE_TAIL_LINES ?? "50"));

function truncate(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= HEAD + TAIL + 1) return text;
  const head = lines.slice(0, HEAD);
  const tail = lines.slice(-TAIL);
  return [...head, `... [naive-truncate: dropped ${lines.length - HEAD - TAIL} lines] ...`, ...tail].join("\n");
}

function truncateResult(r: CompetitorRunResult, fullText: string, keepOutput: boolean): CompetitorRunResult {
  const truncated = truncate(fullText);
  const bytes = Buffer.byteLength(truncated, "utf8");
  return {
    ...r,
    tool: "naive-truncate",
    bytes,
    tokens: estimateTokens(bytes),
    output: keepOutput ? truncated.slice(0, 6000) : undefined,
  };
}

export const naiveTruncateAdapter: CompetitorAdapter = {
  id: "naive-truncate",
  description: "head -N + tail -M baseline. Zero intelligence; free compression.",
  async detect() {
    return { available: true, version: `head=${HEAD} tail=${TAIL} lines` };
  },
  async runCommand(cmd: string, opts: RunCommandOpts = {}): Promise<CompetitorRunResult> {
    // Run raw, capture full text, then truncate.
    const spawn = runViaBash(cmd, opts);
    const full = spawn.stdoutText + spawn.stderrText;
    const truncated = truncate(full);
    const bytes = Buffer.byteLength(truncated, "utf8");
    return {
      tool: "naive-truncate",
      stepLabel: cmd.slice(0, 40),
      ms: spawn.ms,
      bytes,
      tokens: estimateTokens(bytes),
      ok: spawn.error === undefined,
      output: opts.keepOutput ? truncated.slice(0, 6000) : undefined,
    };
  },
  async readFile(path: string, opts: ReadFileOpts = {}): Promise<CompetitorRunResult> {
    const started = Date.now();
    try {
      if (opts.mode === "slice" && opts.start !== undefined && opts.end !== undefined) {
        const lines = readFileSync(path, "utf8").split(/\r?\n/);
        const chunk = lines.slice(opts.start - 1, opts.end).join("\n");
        const bytes = Buffer.byteLength(chunk, "utf8");
        return {
          tool: "naive-truncate", stepLabel: `read:${path}`,
          ms: Date.now() - started, bytes, tokens: estimateTokens(bytes), ok: true,
          output: opts.keepOutput ? chunk.slice(0, 6000) : undefined,
        };
      }
      const text = readFileSync(path, "utf8");
      const truncated = truncate(text);
      const bytes = Buffer.byteLength(truncated, "utf8");
      return {
        tool: "naive-truncate", stepLabel: `read:${path}`,
        ms: Date.now() - started, bytes, tokens: estimateTokens(bytes), ok: true,
        output: opts.keepOutput ? truncated.slice(0, 6000) : undefined,
      };
    } catch (err) {
      return {
        tool: "naive-truncate", stepLabel: `read:${path}`,
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async fetchUrl(url: string, opts: FetchUrlOpts = {}): Promise<CompetitorRunResult> {
    // Delegate fetch to raw, truncate result.
    const rawRes = await rawAdapter.fetchUrl!(url, { keepOutput: true });
    if (!rawRes.ok || !rawRes.output) return { ...rawRes, tool: "naive-truncate" };
    return truncateResult(rawRes, rawRes.output, !!opts.keepOutput);
  },
  async search(query: string, opts: SearchOpts = {}): Promise<CompetitorRunResult> {
    const rawRes = await rawAdapter.search!(query, { ...opts, keepOutput: true });
    if (!rawRes.ok || !rawRes.output) return { ...rawRes, tool: "naive-truncate" };
    return truncateResult(rawRes, rawRes.output, !!opts.keepOutput);
  },
  async index(opts: IndexOpts): Promise<CompetitorRunResult> {
    const rawRes = await rawAdapter.index!({ ...opts, keepOutput: true });
    if (!rawRes.ok || !rawRes.output) return { ...rawRes, tool: "naive-truncate" };
    return truncateResult(rawRes, rawRes.output, !!opts.keepOutput);
  },
};
