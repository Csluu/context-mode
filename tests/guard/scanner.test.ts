import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeRunArtifact } from "../../src/artifacts/run-store.js";
import { createGuardScanReport, scanGuardBuffer, scanGuardText } from "../../src/guard/scanner.js";
import { makeCtxGuard } from "../../src/tools/guard.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: process.cwd(),
    getSessionDir: () => process.cwd(),
    trackResponse: (_tool, response) => response,
  };
}

describe("guard scanner", () => {
  it("redacts secrets for chat returns without leaking the raw token", () => {
    const token = "ghp_abcdefghijklmnopqrstuvwxyzABCDE";
    const decision = scanGuardText(`GITHUB_TOKEN=${token}`, "chat");

    expect(decision.status).toBe("redacted");
    expect(decision.findings.some((finding) => finding.ruleId === "github_token")).toBe(true);
    expect(decision.redactedText).toContain("<redacted:");
    expect(decision.redactedText).not.toContain(token);
  });

  it("blocks persistence surfaces for critical secrets", () => {
    const decision = scanGuardText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", "sidecar");

    expect(decision.status).toBe("blocked");
    expect(decision.findings[0].action).toBe("block-persistence");
  });

  it("blocks binary-like buffers", () => {
    const decision = scanGuardBuffer(Buffer.from([0, 0, 0, 1, 2, 3]), "chat");

    expect(decision.status).toBe("blocked");
    expect(decision.counts.binary_like_payload).toBe(1);
  });

  it("fails reports with high-severity blocked persistence subjects", () => {
    const decision = scanGuardText("Cookie: session=abcdefghijklmnopqrstuvwxyz012345", "sidecar");
    const report = createGuardScanReport([{ surface: "sidecar", pathOrId: "raw.log", decision }]);

    expect(decision.status).toBe("blocked");
    expect(report.totals.high).toBeGreaterThan(0);
    expect(report.failed).toBe(true);
  });
});

describe("ctx_guard tool", () => {
  it("runs fixture self-test and verifies expected guard hits", async () => {
    const tool = makeCtxGuard({ getProjectDir: () => process.cwd() });
    const result = await tool.handler({ mode: "scan-fixtures", json: true }, testContext());
    const payload = JSON.parse(result.content[0].text);

    expect(payload.fixturePassed).toBe(true);
    expect(payload.failures).toEqual([]);
    expect(payload.report.schemaVersion).toBe(1);
    expect(payload.report.totals.critical).toBeGreaterThan(0);
    expect(result.isError).toBeFalsy();
  });

  it("scan-file scans bytes and blocks binary-like files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-guard-file-"));
    try {
      const file = join(dir, "binaryish.log");
      writeFileSync(file, Buffer.from([0, 0, 0, 1, 2, 3]));
      const tool = makeCtxGuard({ getProjectDir: () => dir });
      const result = await tool.handler({ mode: "scan-file", path: file, json: true }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(payload.status).toBe("blocked");
      expect(payload.counts.binary_like_payload).toBe(1);
      expect(result.isError).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scan-file JSON omits redacted file content unless preview is requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-guard-safe-file-"));
    try {
      const file = join(dir, "safe.log");
      writeFileSync(file, "SAFE_PAYLOAD_SHOULD_NOT_BE_RETURNED");
      const tool = makeCtxGuard({ getProjectDir: () => dir });
      const result = await tool.handler({ mode: "scan-file", path: file, json: true }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(payload.status).toBe("allow");
      expect(payload.redactedText).toBeUndefined();
      expect(result.content[0].text).not.toContain("SAFE_PAYLOAD_SHOULD_NOT_BE_RETURNED");

      const preview = await tool.handler({ mode: "scan-file", path: file, json: true, includePreview: true }, testContext());
      expect(JSON.parse(preview.content[0].text).redactedPreview).toContain("SAFE_PAYLOAD_SHOULD_NOT_BE_RETURNED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scan-file rejects paths outside the project root by default", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ctx-guard-project-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "ctx-guard-outside-"));
    try {
      const file = join(outsideDir, "outside.log");
      writeFileSync(file, "outside payload");
      const tool = makeCtxGuard({ getProjectDir: () => projectDir });
      const result = await tool.handler({ mode: "scan-file", path: file, json: true }, testContext());

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("CTX_GUARD_PATH_OUTSIDE_PROJECT");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("scan-file applies the Read deny checker before scanning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-guard-deny-"));
    try {
      const file = join(dir, "blocked.log");
      writeFileSync(file, "blocked payload");
      const tool = makeCtxGuard({
        getProjectDir: () => dir,
        checkFilePath: () => ({ content: [{ type: "text", text: "DENIED_BY_TEST" }], isError: true }),
      });
      const result = await tool.handler({ mode: "scan-file", path: file, json: true }, testContext());

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("DENIED_BY_TEST");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scan-file honors an explicit projectDir override", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "ctx-guard-default-"));
    const targetProjectDir = mkdtempSync(join(tmpdir(), "ctx-guard-target-"));
    try {
      const file = join(targetProjectDir, "target.log");
      writeFileSync(file, "target project payload");
      const tool = makeCtxGuard({
        getProjectDir: () => defaultProjectDir,
        resolveProjectDirOverride: (projectDir) => projectDir,
      });

      const result = await tool.handler({ mode: "scan-file", path: "target.log", projectDir: targetProjectDir, json: true }, testContext());

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content[0].text).status).toBe("allow");
    } finally {
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(targetProjectDir, { recursive: true, force: true });
    }
  });

  it("scan-sidecars honors an explicit projectDir override", async () => {
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "ctx-guard-sidecar-default-"));
    const targetProjectDir = mkdtempSync(join(tmpdir(), "ctx-guard-sidecar-target-"));
    try {
      writeRunArtifact({
        projectDir: defaultProjectDir,
        command: "default",
        stdout: "default output",
        status: "succeeded",
        runId: "11111111-1111-4111-8111-111111111111",
      });
      writeRunArtifact({
        projectDir: targetProjectDir,
        command: "target",
        stdout: "target output",
        status: "succeeded",
        runId: "22222222-2222-4222-8222-222222222222",
      });
      const tool = makeCtxGuard({
        getProjectDir: () => defaultProjectDir,
        resolveProjectDirOverride: (projectDir) => projectDir,
      });

      const result = await tool.handler({ mode: "scan-sidecars", projectDir: targetProjectDir, latest: true, json: true }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(result.isError).toBeFalsy();
      expect(payload.subjects).toHaveLength(1);
      expect(payload.subjects[0].pathOrId).toBe("22222222-2222-4222-8222-222222222222");
    } finally {
      rmSync(defaultProjectDir, { recursive: true, force: true });
      rmSync(targetProjectDir, { recursive: true, force: true });
    }
  });
});
