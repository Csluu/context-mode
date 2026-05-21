import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const ROOT = resolve(import.meta.dirname, "../..");
const CLI_TS = resolve(ROOT, "src/cli.ts");

describe("context-mode run", () => {
  it("runs a shell command, returns parser summary, stores raw output, and preserves exit code", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-cli-run-"));
    try {
      const childScript = "console.error('src/a.test.ts:4 expected active received pending'); process.exit(7)";
      const command = `"${process.execPath}" -e "${childScript}"`;
      const result = spawnSync(process.execPath, [
        TSX_CLI,
        CLI_TS,
        "run",
        "--parser",
        "generic-failure",
        "--",
        command,
      ], {
        cwd: projectDir,
        encoding: "utf8",
      });

      expect(result.status).toBe(7);
      expect(result.stdout).toContain("FAILED 1 failure line(s), exit 7");
      expect(result.stdout).toContain("parser: generic-failure");
      expect(result.stdout).toContain("src/a.test.ts:4");
      expect(result.stdout).toContain("Full raw output:");
      expect(result.stdout).toContain(join(projectDir, ".context-mode", "runs"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("infers a compact parser for known commands when --parser is omitted", () => {
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "run",
      "--",
      "git status",
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("parser: git-status");
    expect(result.stdout).toContain("Full raw output:");
  });

  it("refuses unknown commands unless --raw or --parser is explicit", () => {
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "run",
      "--",
      process.execPath,
      "-e",
      "console.log('would-flood')",
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("requires --parser");
  });

  it("passes through raw stdout and stderr when --raw is used", () => {
    const childScript = "console.log('raw-out'); console.error('raw-err'); process.exit(3)";
    const command = `"${process.execPath}" -e "${childScript}"`;
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "run",
      "--raw",
      "--",
      command,
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("raw-out\n");
    expect(result.stderr).toBe("raw-err\n");
  });

  it("gates experimental CLI subcommands behind CTX_MODE_EXPERIMENTAL=1", () => {
    const blocked = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "cache",
      "explain",
      "--",
      "tsc --noEmit",
    ], {
      cwd: ROOT,
      env: { ...process.env, CTX_MODE_EXPERIMENTAL: "", CONTEXT_MODE_EXPERIMENTAL: "" },
      encoding: "utf8",
    });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("experimental");

    const allowed = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "cache",
      "explain",
      "--",
      "tsc --noEmit",
    ], {
      cwd: ROOT,
      env: { ...process.env, CTX_MODE_EXPERIMENTAL: "1" },
      encoding: "utf8",
    });
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain("ctx_cache");
  });

  it("allows git diff CLI without experimental opt-in", () => {
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "diff",
      "--json",
    ], {
      cwd: ROOT,
      env: { ...process.env, CTX_MODE_EXPERIMENTAL: "", CONTEXT_MODE_EXPERIMENTAL: "" },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("experimental");
    expect(JSON.parse(result.stdout).schemaVersion).toBe(1);
  });

  it("preserves argv boundaries when command is passed as separate arguments", () => {
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "run",
      "--raw",
      "--",
      process.execPath,
      "-e",
      "console.log(JSON.stringify(process.argv.slice(1)))",
      "a b",
      "console.log(\"ok\")",
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["a b", "console.log(\"ok\")"]);
  });

  it("preserves cwd and environment inheritance for argv commands", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-cli-run-"));
    try {
      const result = spawnSync(process.execPath, [
        TSX_CLI,
        CLI_TS,
        "run",
        "--raw",
        "--",
        process.execPath,
        "-e",
        "console.log(JSON.stringify({ cwd: process.cwd(), env: process.env.CONTEXT_MODE_RUN_TEST_ENV }))",
      ], {
        cwd: projectDir,
        env: { ...process.env, CONTEXT_MODE_RUN_TEST_ENV: "visible-to-child" },
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        cwd: projectDir,
        env: "visible-to-child",
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("passes stdin through to argv commands", () => {
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "run",
      "--raw",
      "--",
      process.execPath,
      "-e",
      "process.stdin.setEncoding('utf8'); let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => console.log(data.toUpperCase()))",
    ], {
      cwd: ROOT,
      input: "stdin payload",
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("STDIN PAYLOAD\n");
  });

  it("preserves PATH resolution for argv commands", () => {
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "run",
      "--raw",
      "--",
      nodeName,
      "-e",
      "console.log(process.execPath.length > 0 ? 'path-ok' : 'path-missing')",
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("path-ok\n");
  });

  it("keeps stderr out of stdout when parser output is compacted", () => {
    const result = spawnSync(process.execPath, [
      TSX_CLI,
      CLI_TS,
      "run",
      "--parser",
      "generic-failure",
      "--",
      process.execPath,
      "-e",
      "console.log('plain stdout'); console.error('src/failure.test.ts:9 boom'); process.exit(4)",
    ], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(4);
    expect(result.stdout).toContain("FAILED 1 failure line(s), exit 4");
    expect(result.stdout).toContain("src/failure.test.ts:9");
    expect(result.stderr).toBe("");
  });
});
