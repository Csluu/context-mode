// Token estimation + tool categorization. Anthropic tokenizers are not
// shipped in this env; bytes/CHARS_PER_TOKEN is a stable proxy that both
// sides use identically, so deltas are meaningful even if absolute counts
// drift from the true model tokenizer.
//
// Override the estimator via CHARS_PER_TOKEN (default 4 — close to GPT-4/
// Claude tokenization for English text + code).

export const CHARS_PER_TOKEN = Math.max(1, parseFloat(process.env.CHARS_PER_TOKEN || "4"));

export function estimateTokens(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / CHARS_PER_TOKEN);
}

export type ToolCategory =
  | "read"
  | "search"
  | "execute"
  | "batch"
  | "fetch"
  | "route"
  | "index"
  | "diag"
  | "experimental"
  | "other";

/** Map context-mode tool → native Claude Code tool it displaces, when applicable. */
export type DisplacedNative =
  | "Read"
  | "Bash"
  | "WebFetch"
  | "Grep"
  | "Glob"
  | "(none)";

export interface ToolMeta {
  tool: string;
  category: ToolCategory;
  displaces: DisplacedNative;
}

const META: Record<string, ToolMeta> = {
  ctx_read:              { tool: "ctx_read",              category: "read",         displaces: "Read" },
  ctx_search:            { tool: "ctx_search",            category: "search",       displaces: "Grep" },
  ctx_execute:           { tool: "ctx_execute",           category: "execute",      displaces: "Bash" },
  ctx_execute_file:      { tool: "ctx_execute_file",      category: "execute",      displaces: "Bash" },
  ctx_batch_execute:     { tool: "ctx_batch_execute",     category: "batch",        displaces: "Bash" },
  ctx_fetch_and_index:   { tool: "ctx_fetch_and_index",   category: "fetch",        displaces: "WebFetch" },
  ctx_fetch_run:         { tool: "ctx_fetch_run",         category: "fetch",        displaces: "(none)" },
  ctx_route:             { tool: "ctx_route",             category: "route",        displaces: "(none)" },
  ctx_index:             { tool: "ctx_index",             category: "index",        displaces: "(none)" },
  ctx_doctor:            { tool: "ctx_doctor",            category: "diag",         displaces: "(none)" },
  ctx_stats:             { tool: "ctx_stats",             category: "diag",         displaces: "(none)" },
  ctx_gain:              { tool: "ctx_gain",              category: "diag",         displaces: "(none)" },
  ctx_discover:          { tool: "ctx_discover",          category: "diag",         displaces: "(none)" },
  ctx_purge:             { tool: "ctx_purge",             category: "diag",         displaces: "(none)" },
  ctx_upgrade:           { tool: "ctx_upgrade",           category: "diag",         displaces: "(none)" },
  ctx_diff:              { tool: "ctx_diff",              category: "experimental", displaces: "Bash" },
  ctx_trace:             { tool: "ctx_trace",             category: "experimental", displaces: "(none)" },
  ctx_eval:              { tool: "ctx_eval",              category: "experimental", displaces: "(none)" },
  ctx_guard:             { tool: "ctx_guard",             category: "experimental", displaces: "(none)" },
  ctx_cache:             { tool: "ctx_cache",             category: "experimental", displaces: "(none)" },
};

export function categorize(tool: string): ToolMeta {
  return META[tool] ?? { tool, category: "other", displaces: "(none)" };
}

export interface TokenObservation {
  tool: string;
  invocations: number;
  inputBytes: number;
  outputBytes: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AggregateBuckets {
  byTool: Map<string, TokenObservation>;
  byCategory: Map<ToolCategory, TokenObservation>;
  byDisplaced: Map<DisplacedNative, TokenObservation>;
}

export function emptyBuckets(): AggregateBuckets {
  return { byTool: new Map(), byCategory: new Map(), byDisplaced: new Map() };
}

function bump(map: Map<string, TokenObservation>, key: string, tool: string, inBytes: number, outBytes: number, invocations = 1): void {
  const cur = map.get(key) ?? { tool, invocations: 0, inputBytes: 0, outputBytes: 0, inputTokens: 0, outputTokens: 0 };
  cur.invocations += invocations;
  cur.inputBytes += inBytes;
  cur.outputBytes += outBytes;
  cur.inputTokens += estimateTokens(inBytes);
  cur.outputTokens += estimateTokens(outBytes);
  map.set(key, cur);
}

export function record(
  buckets: AggregateBuckets,
  tool: string,
  inputBytes: number,
  outputBytes: number,
  invocations = 1,
): void {
  const meta = categorize(tool);
  bump(buckets.byTool, meta.tool, meta.tool, inputBytes, outputBytes, invocations);
  bump(buckets.byCategory as Map<string, TokenObservation>, meta.category, meta.tool, inputBytes, outputBytes, invocations);
  bump(buckets.byDisplaced as Map<string, TokenObservation>, meta.displaces, meta.tool, inputBytes, outputBytes, invocations);
}

export function bucketsToObject(b: AggregateBuckets): {
  byTool: Record<string, TokenObservation>;
  byCategory: Record<string, TokenObservation>;
  byDisplaced: Record<string, TokenObservation>;
} {
  return {
    byTool: Object.fromEntries(b.byTool),
    byCategory: Object.fromEntries(b.byCategory),
    byDisplaced: Object.fromEntries(b.byDisplaced),
  };
}

export function totals(b: AggregateBuckets): { invocations: number; inputTokens: number; outputTokens: number; inputBytes: number; outputBytes: number } {
  let invocations = 0, inputTokens = 0, outputTokens = 0, inputBytes = 0, outputBytes = 0;
  for (const v of b.byTool.values()) {
    invocations += v.invocations;
    inputTokens += v.inputTokens;
    outputTokens += v.outputTokens;
    inputBytes += v.inputBytes;
    outputBytes += v.outputBytes;
  }
  return { invocations, inputTokens, outputTokens, inputBytes, outputBytes };
}
