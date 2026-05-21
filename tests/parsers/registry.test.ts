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

  it("summarizes git log output without returning the full history", () => {
    const parsed = parseCommandOutput("git-log", {
      command: "git log --oneline -10",
      stdout: [
        "a1b2c3d add parser coverage",
        "d4e5f6a fix binary output",
        "f7a8b9c update docs",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.parser).toBe("git-log");
    expect(parsed.summary).toContain("commits=3");
    expect(parsed.important[0]?.message).toContain("add parser coverage");
  });

  it("summarizes file listings by entry and extension counts", () => {
    const parsed = parseCommandOutput("file-list", {
      command: "find src -type f",
      stdout: [
        "src/server.ts",
        "src/read/ctx-read.ts",
        "src/parsers/registry.ts",
        "docs/report.md",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.parser).toBe("file-list");
    expect(parsed.summary).toContain("entries=4");
    expect(parsed.summary).toContain("ts=3");
    expect(parsed.important[0]?.message).toBe("src/server.ts");
  });

  it("summarizes package.json without treating script names as build errors", () => {
    const parsed = parseCommandOutput("package-json", {
      command: "cat package.json",
      stdout: JSON.stringify({
        name: "context-mode",
        version: "1.0.135",
        scripts: { build: "tsc", test: "vitest run" },
        dependencies: { zod: "^3.25.0" },
        devDependencies: { vitest: "^3.0.0" },
      }, null, 2),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.parser).toBe("package-json");
    expect(parsed.summary).toContain("name=context-mode");
    expect(parsed.important.map((item) => item.message)).toContain("\"name\": \"context-mode\"");
  });

  it("strips ANSI controls before parsing log output", () => {
    const parsed = parseCommandOutput("ci-log", {
      command: "npm run build",
      stdout: "\u001b[31mERROR\u001b[0m failed to compile\n\u001b[33mWARNING\u001b[0m deprecated option",
      stderr: "",
      exitCode: 1,
    });

    expect(parsed.parser).toBe("ci-log");
    expect(parsed.summary).toContain("errors=1");
    expect(parsed.summary).toContain("warnings=1");
    expect(parsed.important[0]?.message).not.toContain("\u001b[");
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

  it("summarizes pytest terminal output", () => {
    const parsed = parseCommandOutput("pytest", {
      command: "pytest",
      stdout: [
        "FAILED tests/test_auth.py::test_login - AssertionError: expected 200",
        "================ 1 failed, 3 passed, 1 skipped in 2.31s ================",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    });

    expect(parsed.parser).toBe("pytest");
    expect(parsed.summary).toContain("1 failed");
    expect(parsed.summary).toContain("3 passed");
    expect(parsed.important[0]?.message).toContain("test_login");
  });

  it("summarizes TypeScript diagnostics by count and code", () => {
    const parsed = parseCommandOutput("tsc", {
      command: "npx tsc --noEmit",
      stdout: [
        "src/app.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/app.ts(20,3): error TS2304: Cannot find name 'missing'.",
        "Found 2 errors in the same file, starting at: src/app.ts:12",
      ].join("\n"),
      stderr: "",
      exitCode: 2,
    });

    expect(parsed.parser).toBe("tsc");
    expect(parsed.summary).toContain("errors=2");
    expect(parsed.summary).toContain("TS2322=1");
    expect(parsed.important[0]).toMatchObject({ file: "src/app.ts", line: 12 });
  });

  it("summarizes ESLint JSON output", () => {
    const parsed = parseCommandOutput("eslint", {
      command: "eslint -f json src",
      stdout: JSON.stringify([
        {
          filePath: "src/app.ts",
          errorCount: 1,
          warningCount: 1,
          messages: [
            { severity: 2, message: "Unexpected any", ruleId: "@typescript-eslint/no-explicit-any", line: 8 },
            { severity: 1, message: "Missing return type", ruleId: "@typescript-eslint/explicit-function-return-type", line: 10 },
          ],
        },
      ]),
      stderr: "",
      exitCode: 1,
    });

    expect(parsed.summary).toBe("problems: 1 error, 1 warning (2)");
    expect(parsed.important[0]).toMatchObject({ file: "src/app.ts", line: 8 });
    expect(parsed.important[0]?.message).toContain("Unexpected any");
  });

  it("summarizes npm lifecycle failures without dumping the full script output", () => {
    const parsed = parseCommandOutput("npm", {
      command: "npm run build",
      stdout: "vite building...\n",
      stderr: "npm ERR! code ELIFECYCLE\nnpm ERR! Command failed with exit code 1\nsrc/app.ts:5 Error: build failed",
      exitCode: 1,
    });

    expect(parsed.parser).toBe("npm");
    expect(parsed.summary).toContain("npm ERR! code ELIFECYCLE");
    expect(parsed.important.map((item) => item.message).join("\n")).toContain("Command failed");
  });

  it("summarizes Docker logs by severity", () => {
    const parsed = parseCommandOutput("docker-logs", {
      command: "docker logs api",
      stdout: [
        "INFO server started",
        "WARN retrying database connection",
        "ERROR failed to connect to database",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });

    expect(parsed.summary).toBe("lines=3 errors=1 warnings=1");
    expect(parsed.important[0]?.message).toContain("failed to connect");
  });

  it("summarizes Cargo diagnostics", () => {
    const parsed = parseCommandOutput("cargo", {
      command: "cargo test",
      stdout: "test result: FAILED. 1 passed; 1 failed; 0 ignored",
      stderr: "error[E0308]: mismatched types\n --> src/lib.rs:7:5",
      exitCode: 101,
    });

    expect(parsed.parser).toBe("cargo");
    expect(parsed.summary).toContain("test result: FAILED");
    expect(parsed.important[0]?.message).toContain("error[E0308]");
  });

  it("summarizes GitHub CLI JSON output", () => {
    const parsed = parseCommandOutput("gh", {
      command: "gh pr checks --json name,conclusion",
      stdout: JSON.stringify([
        { name: "test", conclusion: "SUCCESS" },
        { name: "lint", conclusion: "FAILURE" },
      ]),
      stderr: "",
      exitCode: 1,
    });

    expect(parsed.summary).toContain("2 item(s)");
    expect(parsed.summary).toContain("1 success");
    expect(parsed.summary).toContain("1 failure");
    expect(parsed.important.map((item) => item.message)).toContain("lint");
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
