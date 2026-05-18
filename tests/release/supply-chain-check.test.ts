import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error - release check script is plain ESM JavaScript.
import { buildSbom, runSupplyChainChecks, validateLicenseExpression } from "../../scripts/supply-chain-check.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

describe("supply-chain release check", () => {
  it("validates approved SPDX license expressions", () => {
    expect(validateLicenseExpression("MIT").ok).toBe(true);
    expect(validateLicenseExpression("(BSD-2-Clause OR MIT OR Apache-2.0)").ok).toBe(true);
    expect(validateLicenseExpression("Custom-License").ok).toBe(false);
  });

  it("builds an SBOM from installed package metadata", () => {
    const sbom = buildSbom(ROOT);

    expect(sbom.bomFormat).toBe("context-mode-simple-sbom");
    expect(sbom.generatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(sbom.generatedAtSource).toBe("reproducible-default");
    expect(sbom.package.name).toBe("context-mode");
    expect(sbom.components.some((component: { name: string; license: string }) =>
      component.name === "zod" && component.license.length > 0
    )).toBe(true);
  });

  it("passes local release trust checks and can write an SBOM artifact", () => {
    const outDir = mkdtempSync(join(tmpdir(), "context-mode-sbom-"));
    try {
      const outPath = join(outDir, "sbom.json");
      const result = runSupplyChainChecks(ROOT, { writeSbomPath: outPath });

      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
      expect(JSON.parse(readFileSync(outPath, "utf8")).components.length).toBeGreaterThan(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("uses package-lock data for transitive components and scans dependency scripts", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-supply-chain-"));
    try {
      writeFileSync(join(root, "LICENSE"), "license", "utf8");
      mkdirSync(join(root, "bin"), { recursive: true });
      writeFileSync(join(root, "bin", "context-mode.js"), "", "utf8");
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        license: "MIT",
        bin: { "context-mode": "bin/context-mode.js" },
        dependencies: { direct: "1.0.0" },
      }), "utf8");
      writeFileSync(join(root, "package-lock.json"), JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { dependencies: { direct: "1.0.0" } },
          "node_modules/direct": { version: "1.0.0", license: "MIT" },
          "node_modules/transitive": { version: "2.0.0", license: "Apache-2.0" },
        },
      }), "utf8");
      mkdirSync(join(root, "node_modules", "direct"), { recursive: true });
      writeFileSync(join(root, "node_modules", "direct", "package.json"), JSON.stringify({
        name: "direct",
        version: "1.0.0",
        license: "MIT",
        scripts: { install: "node install.js" },
      }), "utf8");
      mkdirSync(join(root, "node_modules", "transitive"), { recursive: true });
      writeFileSync(join(root, "node_modules", "transitive", "package.json"), JSON.stringify({
        name: "transitive",
        version: "2.0.0",
        license: "Apache-2.0",
      }), "utf8");

      const result = runSupplyChainChecks(root);

      expect(result.ok).toBe(true);
      expect(result.sbom.components.map((component: { name: string }) => component.name)).toContain("transitive");
      expect(result.sbom.components.find((component: { name: string }) => component.name === "direct")?.lifecycleScripts).toEqual(["install"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails on unpinned better-sqlite3 install paths in project scripts", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-supply-chain-"));
    try {
      writeFileSync(join(root, "LICENSE"), "license", "utf8");
      mkdirSync(join(root, "bin"), { recursive: true });
      mkdirSync(join(root, "scripts"), { recursive: true });
      writeFileSync(join(root, "bin", "context-mode.js"), "", "utf8");
      writeFileSync(join(root, "scripts", "bad.mjs"), "npm install better-sqlite3 --no-save", "utf8");
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        license: "MIT",
        bin: { "context-mode": "bin/context-mode.js" },
      }), "utf8");

      const result = runSupplyChainChecks(root);

      expect(result.ok).toBe(false);
      expect(result.failures.some((failure: string) => failure.includes("without an exact package spec"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
