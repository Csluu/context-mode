import { describe, expect, it } from "vitest";
import { COMMAND_COVERAGE, COMMAND_COVERAGE_MANIFEST_VERSION, findCoverageEntry } from "../../src/routing/command-coverage.js";
import { REWRITE_RULES } from "../../src/routing/rewrite-registry.js";

describe("command coverage manifest", () => {
  it("is versioned and covers every rewrite rule command", () => {
    expect(COMMAND_COVERAGE_MANIFEST_VERSION).toBe(1);
    for (const rule of REWRITE_RULES) {
      expect(findCoverageEntry(rule.command), rule.id).toBeTruthy();
    }
  });

  it("documents safety and fixture coverage for every command", () => {
    for (const entry of COMMAND_COVERAGE) {
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.parser.length).toBeGreaterThan(0);
      expect(entry.fixtures.length).toBeGreaterThanOrEqual(3);
      expect(["low", "medium", "high"]).toContain(entry.dangerLevel);
      expect(["off", "recommend", "rewrite"]).toContain(entry.router);
    }
  });

  it("keeps network commands disabled for auto rewrite", () => {
    const curl = findCoverageEntry("curl https://example.com");
    const wget = findCoverageEntry("wget https://example.com/file");

    expect(curl?.status).toBe("disabled");
    expect(curl?.autoRewriteEligible).toBe(false);
    expect(curl?.dangerLevel).toBe("high");
    expect(wget?.status).toBe("disabled");
    expect(wget?.autoRewriteEligible).toBe(false);
    expect(wget?.dangerLevel).toBe("high");
  });
});
