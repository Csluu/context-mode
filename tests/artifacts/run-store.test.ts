import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupRunArtifacts,
  fetchRunArtifact,
  getRunArtifactRoot,
  listRunArtifacts,
  pinRunArtifact,
  writeRunArtifact,
} from "../../src/artifacts/run-store.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "context-mode-run-store-"));
}

describe("run artifact store", () => {
  function nextTurn<T>(fn: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(fn());
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  it("writes redacted raw output atomically with metadata", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "printenv --token super-secret-value",
        stdout: "TOKEN=abc123\nok",
        stderr: "Authorization: Bearer abc.def.ghi",
        status: "failed",
        exitCode: 1,
        parser: "generic",
        parserConfidence: 0.76,
        parserConfidenceLevel: "medium",
        summary: "failed fixture",
        now: new Date("2026-05-17T10:00:00.000Z"),
        runId: "11111111-1111-4111-8111-111111111111",
      });

      const raw = readFileSync(record.metadata.rawPath, "utf8");
      expect(raw).toContain("TOKEN=<redacted>");
      expect(raw).toContain("Authorization: Bearer <redacted>");
      expect(raw).not.toContain("abc123");
      expect(record.metadata.commandShape).toContain("--token <redacted>");
      expect(record.metadata.commandHash).toHaveLength(64);
      expect(record.metadata.parserConfidence).toBe(0.76);
      expect(record.metadata.parserConfidenceLevel).toBe("medium");
      expect(record.metadata.rawBytes).toBeGreaterThan(0);
      expect(record.metadata.redactedBytes).toBe(Buffer.byteLength(raw));
      expect(record.metadata.storedBytes).toBe(Buffer.byteLength(raw));
      expect(record.metadata.truncated).toBe(false);
      expect(record.metadata.redactionCounts.generic_secret_assignment).toBe(1);
      expect(record.metadata.redactionCounts.authorization_header).toBe(1);
      expect(record.metadata.rawPath.startsWith(getRunArtifactRoot(projectDir))).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(record.artifactDir).mode & 0o777).toBe(0o700);
        expect(statSync(record.metadata.rawPath).mode & 0o777).toBe(0o600);
        expect(statSync(record.metadata.metadataPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("redacts common API tokens, cookies, JWTs, and private keys before persistence", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "node dump-env.js",
        stdout: [
          "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
          "Set-Cookie: sid=secret; HttpOnly",
          "Cookie: sessionid=abc123; theme=dark",
          "x-api-key: secret-header",
          "jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
          "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
        ].join("\n"),
        status: "failed",
      });

      const raw = readFileSync(record.metadata.rawPath, "utf8");
      expect(raw).not.toContain("sk-proj-");
      expect(raw).not.toContain("secret-header");
      expect(raw).not.toContain("abc123");
      expect(raw).not.toContain("BEGIN PRIVATE KEY");
      expect(raw).not.toContain("eyJhbGci");
      expect(raw).toContain("Set-Cookie: <redacted>");
      expect(raw).toContain("x-api-key: <redacted>");
      expect(record.metadata.redactionCounts.openai_token).toBe(1);
      expect(record.metadata.redactionCounts.cookie_header).toBe(2);
      expect(record.metadata.redactionCounts.private_key_block).toBe(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("lists, fetches, truncates, and pins artifacts", () => {
    const projectDir = tempProject();
    try {
      const older = writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: "old",
        status: "succeeded",
        now: new Date("2026-05-17T09:00:00.000Z"),
        runId: "22222222-2222-4222-8222-222222222222",
      });
      const newer = writeRunArtifact({
        projectDir,
        command: "pnpm test",
        stdout: "newer output line",
        status: "failed",
        now: new Date("2026-05-17T11:00:00.000Z"),
        runId: "33333333-3333-4333-8333-333333333333",
      });

      expect(listRunArtifacts(projectDir, 10).map((record) => record.metadata.runId)).toEqual([
        newer.metadata.runId,
        older.metadata.runId,
      ]);
      const latest = fetchRunArtifact({ projectDir, latest: true, maxBytes: 5 });
      expect(latest?.metadata.runId).toBe(newer.metadata.runId);
      expect(latest?.raw).toBe("newer");
      expect(latest?.truncated).toBe(true);

      const pinned = pinRunArtifact(projectDir, newer.metadata.runId);
      expect(pinned?.metadata.pinned).toBe(true);
      expect(fetchRunArtifact({ projectDir, runId: "33333333", maxBytes: 100 })?.metadata.pinned).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("uses deterministic ordering for same-timestamp artifacts", () => {
    const projectDir = tempProject();
    try {
      writeRunArtifact({
        projectDir,
        command: "a",
        stdout: "a",
        status: "unknown",
        now: new Date("2026-05-17T11:00:00.000Z"),
        runId: "11111111-1111-4111-8111-111111111111",
      });
      writeRunArtifact({
        projectDir,
        command: "b",
        stdout: "b",
        status: "unknown",
        now: new Date("2026-05-17T11:00:00.000Z"),
        runId: "22222222-2222-4222-8222-222222222222",
      });

      expect(listRunArtifacts(projectDir, 10).map((record) => record.metadata.runId)).toEqual([
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
      ]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("fetches explicit run ids older than the latest 200 artifacts", () => {
    const projectDir = tempProject();
    try {
      const target = writeRunArtifact({
        projectDir,
        command: "target",
        stdout: "target-output",
        status: "succeeded",
        now: new Date("2026-05-17T00:00:00.000Z"),
        runId: "99999999-9999-4999-8999-999999999999",
      });
      for (let i = 0; i < 201; i++) {
        writeRunArtifact({
          projectDir,
          command: `newer-${i}`,
          stdout: `newer-${i}`,
          status: "succeeded",
          now: new Date(Date.parse("2026-05-18T00:00:00.000Z") + i * 1000),
        });
      }

      expect(listRunArtifacts(projectDir, 200).some((record) => record.metadata.runId === target.metadata.runId)).toBe(false);
      expect(fetchRunArtifact({ projectDir, runId: target.metadata.runId })?.raw).toBe("target-output");
      expect(fetchRunArtifact({ projectDir, runId: "99999" })).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("rejects ambiguous run id prefixes", () => {
    const projectDir = tempProject();
    try {
      writeRunArtifact({
        projectDir,
        command: "first",
        stdout: "first-output",
        status: "succeeded",
        runId: "123456aa-1111-4111-8111-111111111111",
      });
      writeRunArtifact({
        projectDir,
        command: "second",
        stdout: "second-output",
        status: "succeeded",
        runId: "123456bb-2222-4222-8222-222222222222",
      });

      expect(fetchRunArtifact({ projectDir, runId: "123456" })).toBeNull();
      expect(fetchRunArtifact({ projectDir, runId: "123456aa" })?.raw).toBe("first-output");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("handles concurrent writes without run id collisions", async () => {
    const projectDir = tempProject();
    try {
      const records = await Promise.all(
        Array.from({ length: 50 }, (_, i) => nextTurn(() => writeRunArtifact({
          projectDir,
          command: `git diff -- file-${i}.ts`,
          stdout: `output ${i}`,
          status: "unknown",
        }))),
      );
      const ids = new Set(records.map((record) => record.metadata.runId));
      expect(ids.size).toBe(records.length);
      expect(listRunArtifacts(projectDir, 100)).toHaveLength(50);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("enforces per-run sidecar byte caps with an explicit truncation marker", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "node noisy.js",
        stdout: "x".repeat(200),
        status: "succeeded",
        maxRunBytes: 140,
      });

      const raw = readFileSync(record.metadata.rawPath, "utf8");
      expect(record.metadata.truncated).toBe(true);
      expect(record.metadata.redactedBytes).toBe(200);
      expect(record.metadata.storedBytes).toBe(Buffer.byteLength(raw));
      expect(record.metadata.storedBytes).toBeLessThanOrEqual(140);
      expect(raw).toContain("sidecar truncated");
      expect(raw).toContain("original redacted bytes 200");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("keeps storedBytes within tiny per-run caps", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "node noisy.js",
        stdout: "x".repeat(200),
        status: "succeeded",
        maxRunBytes: 40,
      });

      const raw = readFileSync(record.metadata.rawPath, "utf8");
      expect(record.metadata.truncated).toBe(true);
      expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(40);
      expect(record.metadata.storedBytes).toBe(Buffer.byteLength(raw));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("preserves the original log tail when per-run sidecar storage is truncated", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: `START_OF_LOG\n${"middle\n".repeat(200)}FINAL_SUMMARY_OK`,
        status: "failed",
        maxRunBytes: 200,
      });

      const raw = readFileSync(record.metadata.rawPath, "utf8");
      expect(record.metadata.truncated).toBe(true);
      expect(raw).toContain("stored head and tail");

      const head = fetchRunArtifact({
        projectDir,
        runId: record.metadata.runId,
        maxBytes: 80,
        preview: "head",
      })?.raw ?? "";
      expect(head).toContain("START_OF_LOG");
      expect(head).not.toContain("FINAL_SUMMARY_OK");

      const tail = fetchRunArtifact({
        projectDir,
        runId: record.metadata.runId,
        maxBytes: 80,
        preview: "tail",
      })?.raw ?? "";
      expect(tail).toContain("FINAL_SUMMARY_OK");
      expect(tail).not.toContain("START_OF_LOG");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("keeps UTF-8 tail previews on character boundaries", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: `prefix-${"middle-".repeat(50)}😀TAIL`,
        status: "failed",
      });

      const tail = fetchRunArtifact({
        projectDir,
        runId: record.metadata.runId,
        maxBytes: 8,
        preview: "tail",
      })?.raw ?? "";
      expect(tail).toBe("😀TAIL");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("does not delete the just-written artifact when project cap is smaller than one run", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "node noisy.js",
        stdout: "x".repeat(200),
        status: "succeeded",
        maxProjectBytes: 1,
      });

      expect(existsSync(record.metadata.rawPath)).toBe(true);
      expect(fetchRunArtifact({ projectDir, runId: record.metadata.runId, maxBytes: 20 })?.raw).toBe("x".repeat(20));
      expect(listRunArtifacts(projectDir, 10)).toHaveLength(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("treats cleanup with no active policy as a no-op", () => {
    const projectDir = tempProject();
    try {
      const first = writeRunArtifact({
        projectDir,
        command: "first",
        stdout: "first-output",
        status: "succeeded",
        runId: "12121212-1212-4212-8212-121212121212",
      });
      const second = writeRunArtifact({
        projectDir,
        command: "second",
        stdout: "second-output",
        status: "succeeded",
        runId: "34343434-3434-4434-8434-343434343434",
      });

      expect(cleanupRunArtifacts(projectDir)).toEqual({ deleted: 0, bytesDeleted: 0 });
      expect(fetchRunArtifact({ projectDir, runId: first.metadata.runId })?.raw).toBe("first-output");
      expect(fetchRunArtifact({ projectDir, runId: second.metadata.runId })?.raw).toBe("second-output");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns null instead of throwing when metadata points to a missing raw file", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: "safe output",
        status: "succeeded",
      });
      unlinkSync(record.metadata.rawPath);

      expect(fetchRunArtifact({ projectDir, latest: true, maxBytes: 100 })).toBeNull();
      expect(fetchRunArtifact({ projectDir, runId: record.metadata.runId, maxBytes: 100 })).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("cleans old and over-quota unpinned artifacts while keeping pinned artifacts", () => {
    const projectDir = tempProject();
    try {
      const old = writeRunArtifact({
        projectDir,
        command: "old",
        stdout: "old-output",
        status: "succeeded",
        now: new Date("2026-05-01T00:00:00.000Z"),
        runId: "55555555-5555-4555-8555-555555555555",
      });
      const pinned = writeRunArtifact({
        projectDir,
        command: "pinned",
        stdout: "pinned-output",
        status: "succeeded",
        pin: true,
        now: new Date("2026-05-02T00:00:00.000Z"),
        runId: "66666666-6666-4666-8666-666666666666",
      });
      const newer = writeRunArtifact({
        projectDir,
        command: "newer",
        stdout: "newer-output",
        status: "succeeded",
        now: new Date("2026-05-17T00:00:00.000Z"),
        runId: "77777777-7777-4777-8777-777777777777",
      });

      const ttl = cleanupRunArtifacts(projectDir, { ttlDays: 7, now: new Date("2026-05-17T00:00:00.000Z") });
      expect(ttl.deleted).toBe(1);
      expect(listRunArtifacts(projectDir, 10).map((record) => record.metadata.runId)).toEqual([
        newer.metadata.runId,
        pinned.metadata.runId,
      ]);

      const quota = cleanupRunArtifacts(projectDir, { maxProjectBytes: pinned.metadata.storedBytes });
      expect(quota.deleted).toBe(1);
      expect(listRunArtifacts(projectDir, 10).map((record) => record.metadata.runId)).toEqual([
        pinned.metadata.runId,
      ]);
      expect(fetchRunArtifact({ projectDir, runId: old.metadata.runId })).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("ignores tampered metadata that points raw output outside the artifact directory", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: "safe output",
        status: "succeeded",
        runId: "44444444-4444-4444-8444-444444444444",
      });
      writeFileSync(
        record.metadata.metadataPath,
        `${JSON.stringify({
          ...record.metadata,
          rawPath: join(projectDir, "..", "outside-raw.log"),
        }, null, 2)}\n`,
        "utf8",
      );

      expect(listRunArtifacts(projectDir, 10)).toHaveLength(0);
      expect(fetchRunArtifact({ projectDir, latest: true, maxBytes: 100 })).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("ignores symlinked artifact directories outside the run-store root", () => {
    const projectDir = tempProject();
    const outsideProjectDir = tempProject();
    try {
      const outside = writeRunArtifact({
        projectDir: outsideProjectDir,
        command: "outside",
        stdout: "outside-output",
        status: "succeeded",
        now: new Date("2026-05-17T00:00:00.000Z"),
        runId: "abababab-abab-4bab-8bab-abababababab",
      });
      const dayDir = join(getRunArtifactRoot(projectDir), "2026-05-17");
      mkdirSync(dayDir, { recursive: true });
      const linkPath = join(dayDir, "linked-artifact");
      try {
        symlinkSync(outside.artifactDir, linkPath, process.platform === "win32" ? "junction" : "dir");
      } catch {
        return;
      }

      expect(listRunArtifacts(projectDir, 10).map((record) => record.metadata.runId)).not.toContain(outside.metadata.runId);
      expect(fetchRunArtifact({ projectDir, latest: true, maxBytes: 100 })).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideProjectDir, { recursive: true, force: true });
    }
  });

  it("rejects symlinked .context-mode roots before writing artifacts", () => {
    const projectDir = tempProject();
    const outsideDir = tempProject();
    try {
      const contextDir = join(projectDir, ".context-mode");
      try {
        symlinkSync(outsideDir, contextDir, process.platform === "win32" ? "junction" : "dir");
      } catch {
        return;
      }

      expect(() => writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: "should-not-write-outside",
      })).toThrow(/artifact path must not be a symlink|artifact path escapes root/);
      expect(existsSync(join(outsideDir, "runs"))).toBe(false);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("ignores metadata with invalid createdAt values", () => {
    const projectDir = tempProject();
    try {
      const record = writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: "safe output",
        status: "succeeded",
      });
      writeFileSync(
        record.metadata.metadataPath,
        `${JSON.stringify({
          ...record.metadata,
          createdAt: null,
        }, null, 2)}\n`,
        "utf8",
      );

      expect(listRunArtifacts(projectDir, 10)).toHaveLength(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
