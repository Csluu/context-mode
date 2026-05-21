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

  it("keeps pass-through tiny commands to a one-line native hint", async () => {
    const tool = makeCtxRoute();

    const result = await tool.handler({ command: "echo hi", explain: true }, testContext());
    const text = result.content[0].text;

    expect(text).toBe("native-ok: tiny output; use native directly");
    expect(text.length).toBeLessThan(60);
  });

  it("keeps full diagnostics for non-trivial pass-through commands", async () => {
    const tool = makeCtxRoute();

    const result = await tool.handler({ command: "npm.cmd run compare:tokens", explain: true }, testContext());
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      decision: "pass-through",
      safety: { reason: "no matching route rule" },
    });
    expect(payload.direct).toBeUndefined();
  });

  it("does not compact package-manager version objects or verbose interpreter flags", async () => {
    const tool = makeCtxRoute();

    for (const command of ["npm.cmd version", "npm version", "python -v"]) {
      const result = await tool.handler({ command, explain: true }, testContext());
      const payload = JSON.parse(result.content[0].text);

      expect(payload).toMatchObject({
        decision: "pass-through",
        safety: { reason: "no matching route rule" },
      });
      expect(payload.direct).toBeUndefined();
    }
  });

  it("routes common read-only shell commands to compact parsers", async () => {
    const tool = makeCtxRoute();

    const gitLog = JSON.parse((await tool.handler({ command: "git log --oneline -20", explain: true }, testContext())).content[0].text);
    expect(gitLog.selectedRule).toBe("git-log");
    expect(gitLog.route.parser).toBe("git-log");

    const listing = JSON.parse((await tool.handler({ command: "find src -type f", explain: true }, testContext())).content[0].text);
    expect(listing.selectedRule).toBe("file-list");
    expect(listing.route.parser).toBe("file-list");

    const cargo = JSON.parse((await tool.handler({ command: "cargo check", explain: true }, testContext())).content[0].text);
    expect(cargo.selectedRule).toBe("cargo-build-check");
    expect(cargo.route.parser).toBe("cargo");
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
      expect(list.content[0].text).toContain(`project: ${projectDir}`);
      expect(list.content[0].text).toContain(artifact.metadata.runId);
      expect(list.content[0].text).toContain("npm test");

      const overrideList = await overrideTool.handler({ list: true, projectDir }, testContext());
      expect(overrideList.content[0].text).toContain(artifact.metadata.runId);

      const raw = await tool.handler({ runId: "44444444", raw: true }, testContext());
      expect(raw.content[0].text).toContain("Run artifact 44444444-4444-4444-8444-444444444444");
      expect(raw.content[0].text).toContain(`project: ${projectDir}`);
      expect(raw.content[0].text).toContain("--- redacted raw ---");
      expect(raw.content[0].text).not.toContain("--- redacted raw preview");
      expect(raw.content[0].text).toContain("TOKEN=<redacted>");
      expect(raw.content[0].text).not.toContain("abc123");
      expect(raw.content[0].text).toContain("path: .context-mode/runs/");

      const emptyDefaultList = await overrideTool.handler({ list: true }, testContext());
      expect(emptyDefaultList.content[0].text).toContain(`No run artifacts found for project: ${defaultProjectDir}`);

      const largeArtifact = writeRunArtifact({
        projectDir,
        command: "pnpm test",
        stdout: "x".repeat(9_000),
        status: "failed",
        runId: "77777777-7777-4777-8777-777777777777",
        now: new Date("2026-05-17T12:01:00.000Z"),
      });
      const capped = await tool.handler({ runId: largeArtifact.metadata.runId, raw: true }, testContext());
      expect(capped.content[0].text).toContain("...[head preview truncated at 8000 bytes]");
      expect(capped.content[0].text).not.toContain("x".repeat(8_500));

      const codexCapped = await tool.handler(
        { runId: largeArtifact.metadata.runId, raw: true },
        testContextForAdapter("codex"),
      );
      expect(codexCapped.content[0].text).toContain("...[head preview truncated at 6000 bytes]");
      expect(codexCapped.content[0].text).not.toContain("x".repeat(6_500));

      const tailArtifact = writeRunArtifact({
        projectDir,
        command: "npm test --runInBand",
        stdout: `START_OF_LOG\n${"body\n".repeat(300)}FINAL_SUMMARY_OK`,
        status: "failed",
        maxRunBytes: 500,
        runId: "88888888-8888-4888-8888-888888888888",
        now: new Date("2026-05-17T12:02:00.000Z"),
      });
      const tail = await tool.handler(
        { runId: tailArtifact.metadata.runId, raw: true, maxBytes: 200, preview: "tail" },
        testContext(),
      );
      expect(tail.content[0].text).toContain("--- redacted raw preview (tail) ---");
      expect(tail.content[0].text).toContain("FINAL_SUMMARY_OK");
      expect(tail.content[0].text).not.toContain("START_OF_LOG");
      expect(tail.content[0].text).toContain("...[tail preview truncated at 200 bytes]");

      const queryArtifact = writeRunArtifact({
        projectDir,
        command: "node noisy.js",
        stdout: [
          "INFO boot",
          "WARN slow path",
          "ERROR target failure",
          "INFO after failure",
          "ERROR second failure",
        ].join("\n"),
        status: "failed",
        runId: "99999999-9999-4999-8999-999999999999",
        now: new Date("2026-05-17T12:03:00.000Z"),
      });
      const matches = await tool.handler(
        { runId: queryArtifact.metadata.runId, query: "ERROR", contextLines: 1, maxBytes: 500 },
        testContext(),
      );
      expect(matches.content[0].text).toContain("--- redacted raw matches: \"ERROR\" (2/2) ---");
      expect(matches.content[0].text).toContain("2: WARN slow path");
      expect(matches.content[0].text).toContain("3: ERROR target failure");
      expect(matches.content[0].text).toContain("5: ERROR second failure");
      expect(matches.content[0].text).not.toContain("--- redacted raw ---");

      const noMatches = await tool.handler(
        { runId: queryArtifact.metadata.runId, query: "missing" },
        testContext(),
      );
      expect(noMatches.content[0].text).toContain("No matches found.");

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
