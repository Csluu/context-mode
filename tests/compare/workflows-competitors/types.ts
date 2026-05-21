// Shared types for Phase 1 + 1.5 workflows. Steps carry optional oracle (assert)
// and the runner records pass/fail per step. fallbackPolicy on the workflow
// signals whether the runner should retry a failed step via the raw adapter.

export type FallbackPolicy = "raw-on-error" | "none";

export interface BaseStep {
  readonly label: string;
  readonly assert?: (text: string) => boolean | string[];
  readonly skipForTools?: readonly string[];   // skip on these adapter ids
  readonly onlyForTools?: readonly string[];   // restrict to these adapter ids
}

export interface CommandStep extends BaseStep {
  readonly kind: "command";
  readonly command: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
}

export interface ReadStep extends BaseStep {
  readonly kind: "read";
  readonly path: string;
  readonly mode?: "full" | "map" | "outline" | "slice";
  readonly start?: number;
  readonly end?: number;
  readonly compact?: boolean;
}

export interface FetchStep extends BaseStep {
  readonly kind: "fetch";
  readonly url: string;
}

export interface SearchStep extends BaseStep {
  readonly kind: "search";
  readonly query: string;
  readonly source?: string;
}

export interface IndexStep extends BaseStep {
  readonly kind: "index";
  // Either index a directory tree (path) or a command's output (command + label).
  readonly path?: string;
  readonly command?: string;
  readonly source: string;       // label used by ctx_index / ctx_search source filter
  readonly timeoutMs?: number;
}

export type AnyStep = CommandStep | ReadStep | FetchStep | SearchStep | IndexStep;

export interface CompetitorWorkflow {
  readonly name: string;
  readonly description: string;
  readonly steps: readonly AnyStep[];
  readonly fallbackPolicy?: FallbackPolicy;          // default: "raw-on-error"
  readonly beforeAll?: () => Promise<void> | void;
  readonly afterAll?: () => Promise<void> | void;
}
