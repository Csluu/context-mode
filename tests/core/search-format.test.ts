import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../src/types.js";

describe("ctx_search compact formatting", () => {
  it("uses terse lines for tiny corpora and short results", async () => {
    const previous = process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS;
    process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
    try {
      const { formatTinySearchResults, shouldUseTinySearchFormat } = await import("../../src/server.js");
      const results: SearchResult[] = [{
        source: "fixture.md",
        title: "Notes",
        content: "alpha beta gamma",
        rank: -1,
        contentType: "prose",
      }];

      expect(shouldUseTinySearchFormat({
        queryCount: 1,
        sort: "relevance",
        storeChunks: 1,
        results,
      })).toBe(true);

      const text = formatTinySearchResults("alpha", results);
      expect(text).toBe("fixture.md > Notes: alpha beta gamma");
      expect(text).not.toContain("---");
      expect(text.length).toBeLessThan(80);
    } finally {
      if (previous === undefined) delete process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS;
      else process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = previous;
    }
  });
});
