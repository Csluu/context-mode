import { describe, expect, it } from "vitest";
import {
  applyToolResultBudget,
  getAdapterOutputBudget,
  type AdapterOutputBudget,
} from "../../src/adapters/output-budget.js";

function testBudget(maxReturnedBytes: number): AdapterOutputBudget {
  return {
    ...getAdapterOutputBudget("codex"),
    adapter: "codex",
    maxReturnedBytes,
  };
}

describe("adapter output budgets", () => {
  it("provides deterministic adapter-specific budgets", () => {
    expect(getAdapterOutputBudget("codex").maxReturnedBytes).toBe(20_000);
    expect(getAdapterOutputBudget("claude-code").maxReturnedBytes).toBe(24_000);
    expect(getAdapterOutputBudget("unknown").maxImportantItems).toBe(25);
    expect(getAdapterOutputBudget("unknown").maxSearchMatches).toBe(50);
    expect(getAdapterOutputBudget("unknown").maxSidecarPreviewBytes).toBe(8_000);
    expect(getAdapterOutputBudget("unknown").truncationPolicy).toBe("critical-first");
  });

  it("leaves responses unchanged when they fit the adapter budget", () => {
    const result = { content: [{ type: "text" as const, text: "short" }] };
    expect(applyToolResultBudget(result, testBudget(1000))).toBe(result);
  });

  it("caps oversized responses and appends an explicit truncation marker", () => {
    const result = {
      content: [
        { type: "text" as const, text: "a".repeat(300) },
        { type: "text" as const, text: "b".repeat(300) },
      ],
      isError: true,
    };

    const capped = applyToolResultBudget(result, testBudget(240));
    const bytes = capped.content.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);

    expect(bytes).toBeLessThanOrEqual(240);
    expect(capped.isError).toBe(true);
    expect(capped.content.at(-1)?.text).toContain("response truncated for codex");
    expect(capped.content.at(-1)?.text).toContain("omitted");
  });
});
