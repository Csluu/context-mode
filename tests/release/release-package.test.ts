import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error - release script is plain ESM JavaScript.
import {
  defaultReleasePackagePath,
  forbiddenPackageFiles,
  npmTarballName,
  writeReleasePackage,
} from "../../scripts/release-package.mjs";

describe("release package generation", () => {
  it("derives npm tarball names from package metadata", () => {
    expect(npmTarballName({ name: "context-mode", version: "1.2.3" })).toBe("context-mode-1.2.3.tgz");
    expect(npmTarballName({ name: "@scope/context-mode", version: "1.2.3" })).toBe("scope-context-mode-1.2.3.tgz");
  });

  it("runs npm pack into release-artifacts and verifies the tarball exists", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-release-package-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "context-mode-test",
        version: "1.2.3",
      }), "utf8");

      const result = writeReleasePackage(root, {
        execFileSync(_cmd: string, _args: string[], opts: { cwd: string }) {
          const outDir = join(opts.cwd, "out");
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, "context-mode-test-1.2.3.tgz"), "tgz", "utf8");
          return JSON.stringify([{ filename: "context-mode-test-1.2.3.tgz", size: 3, unpackedSize: 3 }]);
        },
        outDir: "out",
      });

      expect(result.filename).toBe("context-mode-test-1.2.3.tgz");
      expect(defaultReleasePackagePath(root)).toBe(join("release-artifacts", "context-mode-test-1.2.3.tgz"));
    } finally {
      // Temp cleanup is intentionally best-effort on Windows where npm-style pack
      // tests can briefly leave handles open.
      try { rmSync(root, { recursive: true, force: true }); } catch {}
    }
  });

  it("rejects release metadata inside the npm package file list", () => {
    expect(forbiddenPackageFiles([
      "build/server.js",
      "build/SHA256SUMS",
      "build/release-provenance.intoto.json",
      "build/release-sbom.json",
      "build/benchmark-report.json",
      "build/release-checklist.md",
    ])).toEqual([
      "build/SHA256SUMS",
      "build/benchmark-report.json",
      "build/release-checklist.md",
      "build/release-provenance.intoto.json",
      "build/release-sbom.json",
    ]);
  });

  it("fails if npm pack reports forbidden release metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-release-package-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "context-mode-test",
        version: "1.2.3",
      }), "utf8");

      expect(() => writeReleasePackage(root, {
        execFileSync(_cmd: string, _args: string[], opts: { cwd: string }) {
          const outDir = join(opts.cwd, "out");
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, "context-mode-test-1.2.3.tgz"), "tgz", "utf8");
          return JSON.stringify([{
            filename: "context-mode-test-1.2.3.tgz",
            size: 3,
            unpackedSize: 3,
            files: [{ path: "build/SHA256SUMS" }],
          }]);
        },
        outDir: "out",
      })).toThrow(/release metadata/);
    } finally {
      try { rmSync(root, { recursive: true, force: true }); } catch {}
    }
  });
});
