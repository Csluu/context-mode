/**
 * Deny-policy project-dir resolution tests.
 *
 * `checkFilePathDenyPolicy` must use the canonical `getProjectDir()` helper so
 * that all supported adapters resolve project root via the full env cascade
 * (CLAUDE_PROJECT_DIR, GEMINI_PROJECT_DIR, VSCODE_CWD, OPENCODE_PROJECT_DIR,
 * PI_PROJECT_DIR, CONTEXT_MODE_PROJECT_DIR, cwd).
 *
 * The previous implementation used `process.env.CLAUDE_PROJECT_DIR ?? cwd()`
 * which fails open (or matches the wrong repo's deny rules) on every
 * non-Claude adapter — a P0 security bug.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(
  resolve(__dirname, "../../src/server.ts"),
  "utf-8",
);

describe("checkFilePathDenyPolicy: project-dir resolution", () => {
  test("function exists in server.ts", () => {
    expect(serverSrc).toContain("function checkFilePathDenyPolicy");
  });

  test("uses canonical getProjectDir() helper, not ad-hoc cascade", () => {
    const fnMatch = serverSrc.match(/function filePathDenyPolicyMessage[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];

    // GREEN: must call getProjectDir()
    expect(body).toMatch(/getProjectDir\(\)/);

    // RED-guard: must NOT use the divergent ad-hoc resolution that
    // skips GEMINI_PROJECT_DIR / VSCODE_CWD / OPENCODE_PROJECT_DIR /
    // PI_PROJECT_DIR / CONTEXT_MODE_PROJECT_DIR.
    expect(body).not.toMatch(
      /process\.env\.CLAUDE_PROJECT_DIR\s*\?\?\s*process\.cwd\(\)/,
    );
    // Also reject the `||` variant of the ad-hoc cascade.
    expect(body).not.toMatch(
      /process\.env\.CLAUDE_PROJECT_DIR\s*\|\|\s*process\.cwd\(\)/,
    );
  });

  test("does not bypass adapter env vars", () => {
    const fnMatch = serverSrc.match(/function filePathDenyPolicyMessage[\s\S]*?^}/m);
    const body = fnMatch![0];
    // The function body itself must not reference any specific adapter env var
    // directly — all resolution flows through getProjectDir().
    expect(body).not.toContain("GEMINI_PROJECT_DIR");
    expect(body).not.toContain("VSCODE_CWD");
    expect(body).not.toContain("OPENCODE_PROJECT_DIR");
    expect(body).not.toContain("PI_PROJECT_DIR");
    expect(body).not.toContain("CONTEXT_MODE_PROJECT_DIR");
    expect(body).not.toContain("IDEA_INITIAL_DIRECTORY");
  });
});

describe("effective project security helpers", () => {
  test("bash deny checks use effective project resolver", () => {
    for (const name of ["checkDenyPolicy", "checkNonShellDenyPolicy"]) {
      const fnMatch = serverSrc.match(new RegExp(`function ${name}[\\s\\S]*?^}`, "m"));
      expect(fnMatch).not.toBeNull();
      const body = fnMatch![0];
      expect(body).toContain("readBashPolicies(getProjectDir())");
      expect(body).not.toContain("readBashPolicies(process.env.CLAUDE_PROJECT_DIR)");
    }
  });

  test("projectDir and cwd overrides are validated before use", () => {
    const projectDirFn = serverSrc.match(/function resolveProjectDirOverride[\s\S]*?^}/m);
    expect(projectDirFn).not.toBeNull();
    expect(projectDirFn![0]).toContain("trusted");
    expect(projectDirFn![0]).toContain("CONTEXT_MODE_ALLOW_PROJECT_OVERRIDE");
    expect(projectDirFn![0]).toContain("CONTEXT_MODE_ALLOWED_PROJECT_DIRS");
    expect(projectDirFn![0]).toContain("isPathInsideOrSame");
    expect(projectDirFn![0]).toContain("requireExistingDirectory");
    expect(serverSrc).toContain("realpathSync");

    const cwdFn = serverSrc.match(/function resolveExecutionCwd[\s\S]*?^}/m);
    expect(cwdFn).not.toBeNull();
    expect(cwdFn![0]).toContain("CONTEXT_MODE_ALLOW_OUTSIDE_CWD");
    expect(cwdFn![0]).toContain("isPathInsideOrSame");
    expect(cwdFn![0]).toContain("requireExistingDirectory");
    expect(cwdFn![0]).toContain("isAbsoluteForCurrentPlatform");
    expect(serverSrc).toContain("function normalizePathForCurrentPlatform");
  });

  test("ctx_index path resolution normalizes Windows/MSYS absolute paths", () => {
    const projectPathFn = serverSrc.match(/function resolveProjectPath[\s\S]*?^}/m);
    expect(projectPathFn).not.toBeNull();
    expect(projectPathFn![0]).toContain("isAbsoluteForCurrentPlatform");
    expect(projectPathFn![0]).toContain("normalizePathForCurrentPlatform");
  });

  test("ctx_index path-backed reads stay owned by ContentStore", () => {
    const start = serverSrc.indexOf('server.registerTool(\n  "ctx_index"');
    const end = serverSrc.indexOf('server.registerTool(\n  "ctx_search"', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = serverSrc.slice(start, end);
    expect(body).toContain("store.index({");
    expect(body).toContain("path: resolvedPath");
    expect(body).not.toContain("readFileSync(resolvedPath");
    expect(body).not.toContain("redactText(readFileSync");
  });

  test("MCP projectDir parameters do not use trusted native override bypass", () => {
    const optionalFn = serverSrc.match(/function withOptionalProjectDir[\s\S]*?^}/m);
    expect(optionalFn).not.toBeNull();
    expect(optionalFn![0]).not.toContain("trusted: true");
  });

  test("ctx_read resolves projectDir before Read deny evaluation", () => {
    const readSrc = readFileSync(
      resolve(__dirname, "../../src/tools/read.ts"),
      "utf-8",
    );
    const handler = readSrc.match(/handler\(input: ReadInput[\s\S]*?^    }/m);
    expect(handler).not.toBeNull();
    const body = handler![0];
    expect(body.indexOf("resolveProjectDirForRead")).toBeLessThan(body.indexOf("checkFilePath"));
    expect(readSrc).toContain("resolveReadTargetPath");
    expect(readSrc).toContain("resolveProjectDirForRead");
    expect(body).toContain("const resolvedPath = resolveReadTargetPath(input.path, projectDir)");
    expect(body).toContain("deps.checkFilePath?.(resolvedPath, projectDir)");
    expect(body).toContain("ctxRead({ ...input, compact: effectiveCompact, path: resolvedPath, projectDir })");
  });
});
