import { capBytes } from "../truncate.js";
import type { PlatformId } from "./types.js";

export type TruncationPolicy = "critical-first";

export interface AdapterOutputBudget {
  readonly adapter: PlatformId | "default";
  readonly maxReturnedBytes: number;
  readonly maxImportantItems: number;
  readonly maxSearchMatches: number;
  readonly maxSidecarPreviewBytes: number;
  readonly truncationPolicy: TruncationPolicy;
}

export interface BudgetableToolResult {
  readonly content: Array<{ type: "text"; text: string }>;
  readonly isError?: boolean;
}

const DEFAULT_BUDGET: AdapterOutputBudget = {
  adapter: "default",
  maxReturnedBytes: 24_000,
  maxImportantItems: 25,
  maxSearchMatches: 50,
  maxSidecarPreviewBytes: 8_000,
  truncationPolicy: "critical-first",
};

const ADAPTER_BUDGETS: Partial<Record<PlatformId, AdapterOutputBudget>> = {
  codex: { ...DEFAULT_BUDGET, adapter: "codex", maxReturnedBytes: 20_000, maxSidecarPreviewBytes: 6_000 },
  cursor: { ...DEFAULT_BUDGET, adapter: "cursor", maxReturnedBytes: 20_000 },
  "vscode-copilot": { ...DEFAULT_BUDGET, adapter: "vscode-copilot", maxReturnedBytes: 20_000 },
  "jetbrains-copilot": { ...DEFAULT_BUDGET, adapter: "jetbrains-copilot", maxReturnedBytes: 20_000 },
  openclaw: { ...DEFAULT_BUDGET, adapter: "openclaw", maxReturnedBytes: 24_000 },
  "claude-code": { ...DEFAULT_BUDGET, adapter: "claude-code", maxReturnedBytes: 24_000 },
};

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function totalContentBytes(result: BudgetableToolResult): number {
  return result.content.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
}

export function getAdapterOutputBudget(adapter?: PlatformId | string | null): AdapterOutputBudget {
  const key = adapter as PlatformId | undefined;
  return (key && ADAPTER_BUDGETS[key]) || DEFAULT_BUDGET;
}

export function applyToolResultBudget<T extends BudgetableToolResult>(
  result: T,
  budget: AdapterOutputBudget,
): T {
  const total = totalContentBytes(result);
  if (total <= budget.maxReturnedBytes) return result;

  const omitted = total - budget.maxReturnedBytes;
  const marker = [
    "",
    "",
    `[context-mode: response truncated for ${budget.adapter} at ${fmtBytes(budget.maxReturnedBytes)}; omitted ~${fmtBytes(omitted)}. Use raw/sidecar retrieval for full output.]`,
  ].join("");
  const markerBytes = Buffer.byteLength(marker);
  if (budget.maxReturnedBytes <= markerBytes) {
    return {
      ...result,
      content: [{ type: "text", text: capBytes(marker, budget.maxReturnedBytes) }],
    };
  }

  let remaining = budget.maxReturnedBytes - markerBytes;
  const content: Array<{ type: "text"; text: string }> = [];
  for (const item of result.content) {
    if (remaining <= 0) break;
    const itemBytes = Buffer.byteLength(item.text);
    if (itemBytes <= remaining) {
      content.push(item);
      remaining -= itemBytes;
      continue;
    }
    content.push({ ...item, text: capBytes(item.text, remaining) });
    remaining = 0;
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }
  const last = content[content.length - 1];
  content[content.length - 1] = {
    ...last,
    text: `${last.text}${marker}`,
  };

  return { ...result, content };
}
