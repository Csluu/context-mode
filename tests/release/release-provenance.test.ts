import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error - release check script is plain ESM JavaScript.
import { buildReleaseProvenance, writeReleaseProvenance } from "../../scripts/release-provenance.mjs";

describe("release provenance generation", () => {
  it("builds an in-toto provenance statement with artifact subjects", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-provenance-"));
    try {
      mkdirSync(join(root, "dist"));
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "context-mode-test",
        version: "1.2.3",
        license: "Elastic-2.0",
        repository: { type: "git", url: "https://example.test/context-mode-test" },
      }), "utf8");
      writeFileSync(join(root, "dist", "artifact.mjs"), "bundle", "utf8");

      const statement = buildReleaseProvenance(root, {
        artifacts: ["dist/artifact.mjs"],
        allowNoGit: true,
        generatedAt: "2026-05-17T00:00:00.000Z",
        invocationId: "test-invocation",
      });

      expect(statement._type).toBe("https://in-toto.io/Statement/v1");
      expect(statement.predicateType).toBe("https://slsa.dev/provenance/v1");
      expect(statement.predicate.buildDefinition.buildType).toBe("https://context-mode.local/build/release-provenance/v1");
      expect(statement.subject).toHaveLength(1);
      expect(statement.subject[0]).toMatchObject({
        name: "dist/artifact.mjs",
        digest: { sha256: expect.any(String) },
      });
      expect(statement.predicate.buildDefinition.externalParameters.package).toMatchObject({
        name: "context-mode-test",
        version: "1.2.3",
        license: "Elastic-2.0",
        repository: "https://example.test/context-mode-test",
      });
      expect(statement.predicate.runDetails.metadata).toMatchObject({
        invocationId: "test-invocation",
        startedOn: "2026-05-17T00:00:00.000Z",
        finishedOn: "2026-05-17T00:00:00.000Z",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes provenance JSON and fails closed on missing artifacts by default", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-provenance-"));
    try {
      writeFileSync(join(root, "artifact.bin"), "payload", "utf8");

      expect(() => buildReleaseProvenance(root, {
        artifacts: ["artifact.bin", "missing.bin"],
        allowNoGit: true,
      })).toThrow(/missing release artifacts/);

      const result = writeReleaseProvenance(root, {
        artifacts: ["artifact.bin", "missing.bin"],
        allowMissing: true,
        allowNoGit: true,
        outDir: "out",
      });

      const written = JSON.parse(readFileSync(result.outPath, "utf8"));
      expect(result.subjectCount).toBe(1);
      expect(written.subject[0].name).toBe("artifact.bin");
      expect(written.predicate.runDetails.byproducts[2].content.missingArtifacts).toEqual(["missing.bin"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("can sign the provenance statement when release signing is enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-provenance-"));
    try {
      writeFileSync(join(root, "artifact.bin"), "payload", "utf8");
      const calls: Array<{ cmd: string; args: string[] }> = [];

      const result = writeReleaseProvenance(root, {
        artifacts: ["artifact.bin"],
        allowNoGit: true,
        outDir: "out",
        sign: true,
        execFileSync(cmd: string, args: string[]) {
          calls.push({ cmd, args });
        },
      });

      expect(result.signed).toBe(true);
      expect(calls).toEqual([{
        cmd: "gpg",
        args: ["--batch", "--yes", "--armor", "--detach-sign", join(root, "out", "release-provenance.intoto.json")],
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when git metadata is unavailable unless explicitly allowed", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-provenance-"));
    try {
      writeFileSync(join(root, "artifact.bin"), "payload", "utf8");

      expect(() => buildReleaseProvenance(root, {
        artifacts: ["artifact.bin"],
      })).toThrow(/git commit unavailable/);
      expect(buildReleaseProvenance(root, {
        artifacts: ["artifact.bin"],
        allowNoGit: true,
      }).subject).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
