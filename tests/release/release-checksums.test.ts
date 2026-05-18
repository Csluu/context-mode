import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error - release check script is plain ESM JavaScript.
import { generateChecksumManifest, writeReleaseChecksums } from "../../scripts/release-checksums.mjs";

describe("release checksum generation", () => {
  it("generates deterministic SHA256 manifest lines for artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-checksums-"));
    try {
      mkdirSync(join(root, "dist"));
      writeFileSync(join(root, "dist", "a.txt"), "alpha", "utf8");
      writeFileSync(join(root, "dist", "b.txt"), "beta", "utf8");

      const manifest = generateChecksumManifest(root, {
        artifacts: ["dist/b.txt", "dist/a.txt"],
      });

      expect(manifest.ok).toBe(true);
      expect(manifest.lines).toHaveLength(2);
      expect(manifest.lines[0]).toContain("dist/a.txt");
      expect(manifest.lines[1]).toContain("dist/b.txt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes unsigned checksum manifest with an explicit signing note by default", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-checksums-"));
    try {
      writeFileSync(join(root, "artifact.bin"), "payload", "utf8");

      const result = writeReleaseChecksums(root, {
        artifacts: ["artifact.bin"],
        outDir: "out",
      });

      expect(result.signed).toBe(false);
      expect(readFileSync(join(root, "out", "SHA256SUMS"), "utf8")).toContain("artifact.bin");
      expect(readFileSync(join(root, "out", "SHA256SUMS.signing-note.txt"), "utf8")).toContain("unsigned");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("invokes gpg signing when requested", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-checksums-"));
    try {
      writeFileSync(join(root, "artifact.bin"), "payload", "utf8");
      const calls: Array<{ cmd: string; args: string[] }> = [];

      const result = writeReleaseChecksums(root, {
        artifacts: ["artifact.bin"],
        outDir: "out",
        sign: true,
        execFileSync(cmd: string, args: string[]) {
          calls.push({ cmd, args });
        },
      });

      expect(result.signed).toBe(true);
      expect(calls).toEqual([{
        cmd: "gpg",
        args: ["--batch", "--yes", "--armor", "--detach-sign", join(root, "out", "SHA256SUMS")],
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when requested signing fails", () => {
    const root = mkdtempSync(join(tmpdir(), "context-mode-checksums-"));
    try {
      writeFileSync(join(root, "artifact.bin"), "payload", "utf8");

      expect(() => writeReleaseChecksums(root, {
        artifacts: ["artifact.bin"],
        outDir: "out",
        sign: true,
        execFileSync() {
          throw new Error("gpg missing");
        },
      })).toThrow(/gpg missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
