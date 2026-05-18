import { describe, expect, it } from "vitest";
import { parseCommandOutput, renderParsedOutput } from "../../src/parsers/registry.js";

describe("output parser registry", () => {
  it("groups rg-style matches by file", () => {
    const parsed = parseCommandOutput("rg", {
      command: "rg auth src",
      stdout: [
        "src/auth.ts:10:export function login() {}",
        "src/auth.ts:22:export function logout() {}",
        "src/user.ts:7:import { login } from './auth'",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.status).toBe("succeeded");
    expect(parsed.summary).toContain("3 match line(s) across 2 file(s)");
    expect(parsed.important[0]).toMatchObject({ file: "src/auth.ts", message: "2 match(es)" });
    expect(parsed.confidence).toMatchObject({ level: "high" });
  });

  it("supports the documented grouped-search parser alias", () => {
    const parsed = parseCommandOutput("grouped-search", {
      command: "rg auth src",
      stdout: "src/a.ts:1:auth\nsrc/a.ts:2:auth\n",
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.parser).toBe("rg");
    expect(parsed.summary).toContain("2 match line(s)");
  });

  it("summarizes Vitest counters instead of falling back to generic exit output", () => {
    const parsed = parseCommandOutput("vitest", {
      command: "npx vitest run",
      stdout: [
        "Test Files  4 passed (4)",
        "Tests  19 passed | 1 skipped (20)",
        "Duration  1.23s",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.parser).toBe("vitest");
    expect(parsed.summary).toContain("files: 4 passed");
    expect(parsed.summary).toContain("tests: 19 passed, 1 skipped");
    expect(parsed.confidence.level).toBe("high");
  });

  it("summarizes Vitest JSON reporter counters", () => {
    const parsed = parseCommandOutput("vitest-json", {
      command: "npx vitest run --reporter=json",
      stdout: JSON.stringify({
        numPassedTestSuites: 3,
        numFailedTestSuites: 1,
        numPendingTestSuites: 0,
        numPassedTests: 18,
        numFailedTests: 2,
        numPendingTests: 1,
        testResults: [{ assertionResults: [{ status: "failed", failureMessage: "expected true received false" }] }],
      }),
      stderr: "",
      exitCode: 1,
    });

    expect(parsed.parser).toBe("vitest-json");
    expect(parsed.summary).toContain("files: 1 failed, 3 passed");
    expect(parsed.summary).toContain("tests: 2 failed, 18 passed, 1 skipped");
    expect(parsed.important[0]?.message).toContain("expected true");
  });

  it("summarizes Playwright counters instead of falling back to generic exit output", () => {
    const parsed = parseCommandOutput("playwright", {
      command: "npx playwright test",
      stdout: "  1 failed\n  7 passed (12.4s)",
      stderr: "Error: expect(locator).toBeVisible() failed",
      exitCode: 1,
    });

    expect(parsed.parser).toBe("playwright");
    expect(parsed.summary).toContain("1 failed");
    expect(parsed.summary).toContain("7 passed");
    expect(parsed.important.length).toBeGreaterThan(0);
  });

  it("summarizes Playwright JSON reporter counters", () => {
    const parsed = parseCommandOutput("playwright-json", {
      command: "npx playwright test --reporter=json",
      stdout: JSON.stringify({
        stats: { expected: 7, unexpected: 1, skipped: 2, flaky: 1 },
        suites: [{ specs: [{ tests: [{ results: [{ status: "failed", error: { message: "Error: timed out" } }] }] }] }],
      }),
      stderr: "",
      exitCode: 1,
    });

    expect(parsed.parser).toBe("playwright-json");
    expect(parsed.summary).toContain("tests: 1 failed, 1 flaky, 7 passed, 2 skipped");
    expect(parsed.important[0]?.message).toContain("timed out");
  });

  it("summarizes git diff without returning full hunks", () => {
    const parsed = parseCommandOutput("git-diff", {
      command: "git diff",
      stdout: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.summary).toBe("1 file(s), +1/-1");
    const rendered = renderParsedOutput(parsed);
    expect(rendered).toContain("parser: git-diff (high confidence");
    expect(rendered).toContain("- src/a.ts changed src/a.ts");
  });

  it("summarizes git diff --stat output", () => {
    const parsed = parseCommandOutput("git-diff", {
      command: "git diff --stat",
      stdout: [
        " cli.bundle.mjs                             | 368 ++++++++++++++---------------",
        " package.json                               |   2 +",
        " server.bundle.mjs                          | 288 +++++++++++-----------",
        " 14 files changed, 677 insertions(+), 353 deletions(-)",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.summary).toBe("14 file(s), +677/-353");
    expect(parsed.important[0]).toMatchObject({
      file: "cli.bundle.mjs",
      message: "changed cli.bundle.mjs",
    });
    expect(parsed.confidence).toMatchObject({ level: "high" });
  });

  it("unwraps JSON command wrappers before parsing git status", () => {
    const parsed = parseCommandOutput("git-status", {
      command: "git status",
      stdout: JSON.stringify({
        cwd: "C:\\Users\\chris\\Documents\\GitHub\\mission-control-master",
        status: 0,
        stdout: "On branch main\nnothing to commit, working tree clean\n",
        stderr: "",
      }),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.summary).toBe("clean on main");
    expect(parsed.important.map((item) => item.message)).toContain("On branch main");
    expect(parsed.confidence.level).toBe("high");
  });

  it("summarizes git status --short output", () => {
    const parsed = parseCommandOutput("git-status", {
      command: "git status --short",
      stdout: [
        " M package.json",
        "M  src/server.ts",
        "?? scratch.txt",
        "!! ignored.log",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.summary).toBe("changed=2 untracked=true");
    expect(parsed.important.map((item) => item.message)).toContain("M package.json");
    expect(parsed.important.map((item) => item.message)).toContain("?? scratch.txt");
    expect(parsed.important.map((item) => item.message)).toContain("!! ignored.log");
  });

  it("caps rendered important items and reports omitted item count", () => {
    const parsed = parseCommandOutput("rg", {
      command: "rg auth src",
      stdout: Array.from({ length: 4 }, (_, index) => `src/file-${index}.ts:1:auth`).join("\n"),
      stderr: "",
      exitCode: 0,
    });

    const rendered = renderParsedOutput(parsed, { maxImportantItems: 2 });

    expect(rendered.match(/^- src\/file-/gm)).toHaveLength(2);
    expect(rendered).toContain('"importantItems":2');
  });

  it("does not report failure lines from successful build asset names", () => {
    const parsed = parseCommandOutput("generic-failure", {
      command: "npm run build",
      stdout: [
        "dist/assets/Error-ByGS26ya.js 4.20 kB",
        "dist/assets/index.js 12.50 kB",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.status).toBe("succeeded");
    expect(parsed.summary).toBe("exit 0");
    expect(parsed.important).toHaveLength(0);
  });

  it("keeps failure-focused lines for non-zero exits", () => {
    const parsed = parseCommandOutput("generic-failure", {
      command: "npm test",
      stdout: "running parser tests",
      stderr: "src/parser.test.ts:42 Error: expected active received pending",
      exitCode: 1,
    });

    expect(parsed.status).toBe("failed");
    expect(parsed.summary).toBe("1 failure line(s), exit 1");
    expect(parsed.important.map((item) => item.message)).toContain(
      "src/parser.test.ts:42 Error: expected active received pending",
    );
  });

  it("returns diagnostics for unknown parsers", () => {
    const parsed = parseCommandOutput("missing-parser", {
      command: "command",
      stdout: "raw output",
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.status).toBe("unknown");
    expect(parsed.confidence.score).toBe(0);
    expect(parsed.diagnostics?.[0]).toContain("parser not found");
  });
});
