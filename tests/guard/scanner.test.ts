import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
      const tool = makeCtxGuard({ getProjectDir: () => process.cwd() });
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
      const tool = makeCtxGuard({ getProjectDir: () => process.cwd() });
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
});
