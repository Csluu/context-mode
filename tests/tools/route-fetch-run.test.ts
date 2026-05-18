import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeRunArtifact } from "../../src/artifacts/run-store.js";
import { makeCtxFetchRun } from "../../src/tools/fetch-run.js";
import { makeCtxRoute } from "../../src/tools/route.js";
import type { ToolContext } from "../../src/tools/types.js";

function testContext(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: mkdtempSync(join(tmpdir(), "context-mode-tool-test-root-")),
    getSessionDir: () => tmpdir(),
    trackResponse: (_toolName, response) => response,
  };
}

function testContextForAdapter(adapter: string): ToolContext {
  return {
    ...testContext(),
    getAdapterId: () => adapter,
  };
}

describe("ctx_route tool", () => {
  it("returns route explanation JSON without executing commands", async () => {
    const decisions: string[] = [];
    const tool = makeCtxRoute();
    const result = await tool.handler(
      { command: "pnpm test --reporter=json", explain: true, mode: "recommend", adapterCanRewrite: true },
      testContext(),
    );
    const payload = JSON.parse(result.content[0].text);

    expect(payload.selectedRule).toBe("node-test-existing-json-reporter");
    expect(payload.safety.reason).toContain("structured");
    expect(payload.rejectedRules.some((rule: { rule: string }) => rule.rule === "node-test-generic")).toBe(true);

    const emittingTool = makeCtxRoute({
      onDecision: ({ decision }) => decisions.push(decision.decision),
    });
    await emittingTool.handler({ command: "git status", explain: false }, testContext());
    expect(decisions).toEqual(["recommend"]);
  });
});

describe("ctx_fetch_run tool", () => {
  it("lists and fetches redacted run artifacts", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-fetch-run-"));
    const defaultProjectDir = mkdtempSync(join(tmpdir(), "context-mode-fetch-run-default-"));
    try {
      const artifact = writeRunArtifact({
        projectDir,
        command: "npm test",
        stdout: "TOKEN=abc123\nfailed line",
        status: "failed",
        runId: "44444444-4444-4444-8444-444444444444",
        now: new Date("2026-05-17T12:00:00.000Z"),
      });
      const tool = makeCtxFetchRun({ getProjectDir: () => projectDir });
      const overrideTool = makeCtxFetchRun({ getProjectDir: () => defaultProjectDir });

      const list = await tool.handler({ list: true }, testContext());
      expect(list.content[0].text).toContain(artifact.metadata.runId);
      expect(list.content[0].text).toContain("npm test");

      const overrideList = await overrideTool.handler({ list: true, projectDir }, testContext());
      expect(overrideList.content[0].text).toContain(artifact.metadata.runId);

      const raw = await tool.handler({ runId: "44444444", raw: true }, testContext());
      expect(raw.content[0].text).toContain("Run artifact 44444444-4444-4444-8444-444444444444");
      expect(raw.content[0].text).toContain("TOKEN=<redacted>");
      expect(raw.content[0].text).not.toContain("abc123");
      expect(raw.content[0].text).toContain("path: .context-mode/runs/");
      expect(raw.content[0].text).not.toContain(projectDir);

      const largeArtifact = writeRunArtifact({
        projectDir,
        command: "pnpm test",
        stdout: "x".repeat(9_000),
        status: "failed",
        runId: "77777777-7777-4777-8777-777777777777",
        now: new Date("2026-05-17T12:01:00.000Z"),
      });
      const capped = await tool.handler({ runId: largeArtifact.metadata.runId, raw: true }, testContext());
      expect(capped.content[0].text).toContain("...[truncated at 8000 bytes]");
      expect(capped.content[0].text).not.toContain("x".repeat(8_500));

      const codexCapped = await tool.handler(
        { runId: largeArtifact.metadata.runId, raw: true },
        testContextForAdapter("codex"),
      );
      expect(codexCapped.content[0].text).toContain("...[truncated at 6000 bytes]");
      expect(codexCapped.content[0].text).not.toContain("x".repeat(6_500));

      const pinned = await tool.handler({ latest: true, pin: true }, testContext());
      expect(pinned.content[0].text).toContain("pinned: true");

      const missing = await tool.handler({ runId: "missing", raw: true }, testContext());
      expect(missing.isError).toBe(true);
      expect(missing.content[0].text).toContain("CTX_ARTIFACT_NOT_FOUND");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(defaultProjectDir, { recursive: true, force: true });
    }
  });
});
