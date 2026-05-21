import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildScenarioSavings,
  isSerenaSemanticallyUsable,
  renderNonRawScenarios,
  renderWorkflowBreakout,
  type SerenaBaselineRow,
} from "./run-tokens.js";
import { buildMeta } from "./lib.js";
import { normalizeSerenaResearchRow } from "./research-report.js";

function rawRow(tool: string, scenario: string, rawBytes: number) {
  return { tool, scenario, rawEquivalent: "raw", rawBytes, rawTokens: Math.round(rawBytes / 4) };
}

function serenaRow(tool: string, scenario: string, bytes: number): SerenaBaselineRow {
  return {
    tool,
    scenario,
    serenaTool: "get_symbols_overview",
    applicable: true,
    bytes,
    tokens: Math.round(bytes / 4),
    ms: 1,
    ok: true,
  };
}

describe("token comparison report semantics", () => {
  it("uses Serena only for semantically valid code-navigation lanes", () => {
    expect(isSerenaSemanticallyUsable(serenaRow("workflow:codebase-explore", "symbols", 10))).toBe(true);
    expect(isSerenaSemanticallyUsable({ ...serenaRow("workflow:codebase-explore", "search", 10), serenaTool: "find_symbol" })).toBe(true);
    expect(isSerenaSemanticallyUsable({ ...serenaRow("workflow:semantic-nav-control", "search-refs", 10), serenaTool: "find_referencing_symbols" })).toBe(true);
    expect(isSerenaSemanticallyUsable(serenaRow("workflow:compact-vs-serena-bundle", "map", 10))).toBe(false);
    expect(isSerenaSemanticallyUsable(serenaRow("workflow:compact-vs-serena-json", "outline", 10))).toBe(false);
    expect(isSerenaSemanticallyUsable(serenaRow("workflow:markdown-outline", "map", 10))).toBe(false);
    expect(isSerenaSemanticallyUsable({ ...serenaRow("ctx_search", "single-q-alpha", 10), serenaTool: "find_symbol" })).toBe(false);
  });

  it("uses the same Serena semantic gate in the research report", () => {
    expect(normalizeSerenaResearchRow(serenaRow("workflow:codebase-explore", "symbols", 10))).toMatchObject({
      applicable: true,
      ok: true,
      bytes: 10,
    });
    expect(normalizeSerenaResearchRow(serenaRow("workflow:markdown-outline", "map", 10))).toMatchObject({
      applicable: false,
      ok: false,
      bytes: 10,
    });
  });

  it("does not let tiny but semantically invalid Serena output win the composite", () => {
    const dir = mkdtempSync(join(tmpdir(), "context-mode-run-tokens-"));
    try {
      const file = join(dir, "per-tool.json");
      writeFileSync(file, JSON.stringify({
        rows: [
          { tool: "workflow:compact-vs-serena-bundle", scenario: "map", fork: { bytes: { median: 100 } }, upstream: { successes: 0 } },
          { tool: "workflow:codebase-explore", scenario: "symbols", fork: { bytes: { median: 100 } }, upstream: { successes: 0 } },
        ],
      }), "utf8");
      const raw = new Map([
        ["workflow:compact-vs-serena-bundle::map", rawRow("workflow:compact-vs-serena-bundle", "map", 1000)],
        ["workflow:codebase-explore::symbols", rawRow("workflow:codebase-explore", "symbols", 1000)],
      ]);
      const serena = new Map([
        ["workflow:compact-vs-serena-bundle::map", serenaRow("workflow:compact-vs-serena-bundle", "map", 10)],
        ["workflow:codebase-explore::symbols", serenaRow("workflow:codebase-explore", "symbols", 10)],
      ]);

      const rows = buildScenarioSavings([file], raw, serena);

      expect(rows.find((row) => row.tool.includes("bundle"))?.forkPlusSerenaBytes).toBe(100);
      expect(rows.find((row) => row.tool.includes("codebase"))?.forkPlusSerenaBytes).toBe(10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters malformed no-raw rows instead of emitting undefined scenarios", () => {
    const dir = mkdtempSync(join(tmpdir(), "context-mode-run-tokens-"));
    try {
      const file = join(dir, "per-tool.json");
      writeFileSync(file, JSON.stringify({
        rows: [
          { workflow: "wf", fork: { steps: [] } },
          { workflow: "wf", step: "read", tool: "ctx_read", forkBytes: 10 },
          { tool: "ctx_read", scenario: "undefined", fork: { bytes: { median: 0 } }, upstream: { successes: 0 } },
          { tool: "ctx_route", scenario: "git-diff", fork: { bytes: { median: 120 } }, upstream: { successes: 0 } },
        ],
      }), "utf8");

      const md = renderNonRawScenarios([file], new Map(), new Map());

      expect(md).toContain("| ctx_route | git-diff | 120 | n/a | n/a |");
      expect(md).not.toContain("| ctx_read | undefined |");
      expect(md).toContain("Invalid rows filtered:** 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds a quality-adjusted workflow aggregate that excludes failed and oracle-bad steps", () => {
    const md = renderWorkflowBreakout({
      rows: [{
        workflow: "sample",
        description: "sample workflow",
        fork: {
          steps: [
            { label: "good", tool: "ctx_read", bytes: 10, ok: true, hasOracle: true, oracleOk: true },
            { label: "failed", tool: "ctx_read", bytes: 1, ok: false, hasOracle: true, oracleOk: true },
            { label: "bad-oracle", tool: "ctx_route", bytes: 2, ok: true, hasOracle: true, oracleOk: false },
            { label: "missing-ok", tool: "ctx_route", bytes: 3, hasOracle: true, oracleOk: true },
          ],
        },
        upstream: { steps: [] },
      }],
    }, new Map(), new Map([
      ["sample::good", 100],
      ["sample::failed", 1000],
      ["sample::bad-oracle", 1000],
      ["sample::missing-ok", 1000],
    ]));

    expect(md).toContain("Workflow aggregate (quality-adjusted)");
    expect(md).toContain("| Raw native | 1/4 | 100 |");
    expect(md).toContain("| Fork | 1/4 | 10 |");
    expect(md).toContain("failed/refusal=1, oracle-failed=1, no-oracle=1");
    expect(md).toContain("all observed payload bytes, not quality-adjusted");
  });

  it("stamps reproducibility metadata for compare reports", () => {
    const meta = buildMeta("unit");

    expect(meta.fork_sha.length).toBeGreaterThan(0);
    expect(meta.fork_dirty).toMatch(/^(true|false)$/);
    expect(Number.isInteger(Number(meta.fork_dirty_count))).toBe(true);
    expect(Number.isInteger(Number(meta.fork_changed_files))).toBe(true);
  });
});
