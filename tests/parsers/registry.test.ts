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
