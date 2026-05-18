import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAdapterValidationReport,
  buildFixtureCoverage,
  buildSchemaSnapshot,
  buildSemanticDiffFixtureReport,
  buildTaskCacheReadinessReport,
  writeReleaseCandidateReports,
} from "../../scripts/release-candidate-reports.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

describe("release candidate reports", () => {
  it("builds required report payloads from repo evidence", () => {
    const generatedAt = "2026-05-17T00:00:00.000Z";

    expect(buildAdapterValidationReport(ROOT, { generatedAt }).adapters.length).toBeGreaterThan(0);
    expect(buildAdapterValidationReport(ROOT, { generatedAt }).validatedBy)
      .toContain("tests/hooks/hook-rewrite.test.ts");
    expect(buildSchemaSnapshot(ROOT, { generatedAt }).toolSources)
      .toContain("src/tools/doctor.ts");
    expect(buildSchemaSnapshot(ROOT, { generatedAt }).guardSources)
      .toContain("src/guard/scanner.ts");
    expect(buildFixtureCoverage(ROOT, { generatedAt }).coverageAreas)
      .toContain("ctx_read binary/path/symlink/repeated-read behavior");
    expect(buildFixtureCoverage(ROOT, { generatedAt }).coverageAreas)
      .toContain("ctx_eval fast fixture harness");
    expect(buildFixtureCoverage(ROOT, { generatedAt }).missingEvidence).toEqual([]);
    expect(buildFixtureCoverage(ROOT, { generatedAt }).coverageEvidence.every((entry: { present: string[] }) =>
      entry.present.length > 0
    )).toBe(true);
    expect(buildSemanticDiffFixtureReport(ROOT, { generatedAt }).missing).toEqual([]);
    expect(buildTaskCacheReadinessReport(ROOT, { generatedAt }).servingEnabled).toBe("explicit-canary-only");
  });

  it("writes all required release-candidate artifact files", () => {
    const outDir = mkdtempSync(join(tmpdir(), "context-mode-release-reports-"));
    try {
      const written = writeReleaseCandidateReports(ROOT, {
        outDir,
        generatedAt: "2026-05-17T00:00:00.000Z",
      });

      const names = written.map((file) => file.replace(/\\/g, "/"));
      expect(names.some((file) => file.endsWith("adapter-validation-report.json"))).toBe(true);
      expect(names.some((file) => file.endsWith("schema-snapshot.json"))).toBe(true);
      expect(names.some((file) => file.endsWith("fixture-coverage.json"))).toBe(true);
      expect(names.some((file) => file.endsWith("semantic-diff-fixture-report.json"))).toBe(true);
      expect(names.some((file) => file.endsWith("task-cache-readiness-report.json"))).toBe(true);
      expect(names.some((file) => file.endsWith("release-checklist.md"))).toBe(true);
      expect(existsSync(join(outDir, "release-checklist.md"))).toBe(true);
      const checklist = readFileSync(join(outDir, "release-checklist.md"), "utf8");
      expect(checklist).toContain("benchmark-report.json");
      expect(checklist).toContain("skip-audit-report.json");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("fails report generation when fixture coverage evidence is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-release-reports-root-"));
    const outDir = mkdtempSync(join(tmpdir(), "context-mode-release-reports-out-"));
    try {
      mkdirSync(join(root, "src", "tools"), { recursive: true });
      mkdirSync(join(root, "src", "routing"), { recursive: true });
      mkdirSync(join(root, "src", "parsers"), { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "context-mode-test",
        version: "1.2.3",
        bin: { "context-mode": "./cli.js" },
      }), "utf8");
      writeFileSync(join(root, "src", "tools", "doctor.ts"), "", "utf8");

      expect(buildFixtureCoverage(root, {
        generatedAt: "2026-05-17T00:00:00.000Z",
      }).missingEvidence).toContain("secret redaction");
      expect(() => writeReleaseCandidateReports(root, {
        outDir,
        generatedAt: "2026-05-17T00:00:00.000Z",
      })).toThrow(/fixture coverage evidence missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
