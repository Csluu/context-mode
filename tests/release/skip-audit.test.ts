import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

describe("skip audit manifest", () => {
  it("manifests every skipped/todo test marker in strict mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "context-mode-skip-audit-"));
    const out = join(dir, "skip-audit-report.json");
    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/skip-audit.mjs", "--strict", "--json-out", out],
        { cwd: ROOT, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(out, "utf8"));
      expect(report.manifestPresent).toBe(true);
      expect(report.unknown).toBe(0);
      expect(report.manifestIssues).toEqual([]);
      expect(report.manifested).toBe(report.total);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
