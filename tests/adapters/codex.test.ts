import "../setup-home";
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CodexAdapter } from "../../src/adapters/codex/index.js";

function withMcpSentinel<T>(fn: (env: NodeJS.ProcessEnv) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "context-mode-codex-mcp-"));
  writeFileSync(join(dir, `context-mode-mcp-ready-${process.pid}`), String(process.pid), "utf-8");
  try {
    return fn({ ...process.env, CONTEXT_MODE_MCP_SENTINEL_DIR: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CodexAdapter", () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  // ── Capabilities ──────────────────────────────────────

  describe("capabilities", () => {
    it("preToolUse is true", () => {
      expect(adapter.capabilities.preToolUse).toBe(true);
    });

    it("postToolUse is true", () => {
      expect(adapter.capabilities.postToolUse).toBe(true);
    });

    it("sessionStart is true", () => {
      expect(adapter.capabilities.sessionStart).toBe(true);
    });

    it("canModifyArgs is false (Codex does not support updatedInput)", () => {
      expect(adapter.capabilities.canModifyArgs).toBe(false);
    });

    it("canModifyOutput is false (Codex does not support updatedMCPToolOutput)", () => {
      expect(adapter.capabilities.canModifyOutput).toBe(false);
    });

    it("canInjectSessionContext is true", () => {
      expect(adapter.capabilities.canInjectSessionContext).toBe(true);
    });

    it("paradigm is json-stdio", () => {
      expect(adapter.paradigm).toBe("json-stdio");
    });
  });

  // ── parsePreToolUseInput ──────────────────────────────

  describe("parsePreToolUseInput", () => {
    it("extracts tool_name from input", () => {
      const event = adapter.parsePreToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        session_id: "s1",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.toolName).toBe("Bash");
    });

    it("extracts session_id", () => {
      const event = adapter.parsePreToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        session_id: "codex-123",
        cwd: "/proj",
        hook_event_name: "PreToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.sessionId).toBe("codex-123");
    });

    it("extracts projectDir from cwd", () => {
      const event = adapter.parsePreToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        session_id: "s1",
        cwd: "/my/project",
        hook_event_name: "PreToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.projectDir).toBe("/my/project");
    });

    it("falls back to CODEX_PROJECT_DIR when cwd missing", () => {
      const savedCwd = process.env.CODEX_PROJECT_DIR;
      process.env.CODEX_PROJECT_DIR = "/env/project";
      try {
        const event = adapter.parsePreToolUseInput({
          tool_name: "Bash",
          tool_input: { command: "ls" },
          session_id: "s1",
          hook_event_name: "PreToolUse",
        });
        expect(event.projectDir).toBe("/env/project");
      } finally {
        if (savedCwd === undefined) delete process.env.CODEX_PROJECT_DIR;
        else process.env.CODEX_PROJECT_DIR = savedCwd;
      }
    });

    it("falls back to process.cwd() when cwd and env both missing", () => {
      const savedCwd = process.env.CODEX_PROJECT_DIR;
      delete process.env.CODEX_PROJECT_DIR;
      try {
        const event = adapter.parsePreToolUseInput({
          tool_name: "Bash",
          tool_input: { command: "ls" },
          session_id: "s1",
          hook_event_name: "PreToolUse",
        });
        expect(event.projectDir).toBe(process.cwd());
      } finally {
        if (savedCwd !== undefined) process.env.CODEX_PROJECT_DIR = savedCwd;
      }
    });

    it("post/precompact/sessionstart parsers also fall back to process.cwd()", () => {
      const savedCwd = process.env.CODEX_PROJECT_DIR;
      delete process.env.CODEX_PROJECT_DIR;
      try {
        const post = adapter.parsePostToolUseInput({ tool_name: "Bash" });
        expect(post.projectDir).toBe(process.cwd());

        const compact = adapter.parsePreCompactInput({ session_id: "s1" });
        expect(compact.projectDir).toBe(process.cwd());

        const start = adapter.parseSessionStartInput({ session_id: "s1" });
        expect(start.projectDir).toBe(process.cwd());
      } finally {
        if (savedCwd !== undefined) process.env.CODEX_PROJECT_DIR = savedCwd;
      }
    });
  });

  // ── formatPreToolUseResponse ──────────────────────────

  describe("formatPreToolUseResponse", () => {
    it("deny returns hookSpecificOutput with hookEventName and permissionDecision deny", () => {
      const resp = adapter.formatPreToolUseResponse({
        decision: "deny",
        reason: "blocked",
      });
      const hso = (resp as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
      expect(hso.hookEventName).toBe("PreToolUse");
      expect(hso.permissionDecision).toBe("deny");
      expect(hso.permissionDecisionReason).toBe("blocked");
    });

    it("allow returns empty object (passthrough)", () => {
      const resp = adapter.formatPreToolUseResponse({ decision: "allow" });
      expect(resp).toEqual({});
    });
  });

  // ── parsePostToolUseInput ─────────────────────────────

  describe("parsePostToolUseInput", () => {
    it("extracts tool_response", () => {
      const event = adapter.parsePostToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        tool_response: "hi\n",
        session_id: "s1",
        cwd: "/tmp",
        hook_event_name: "PostToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.toolOutput).toBe("hi\n");
    });
  });

  // ── formatPostToolUseResponse ─────────────────────────

  describe("formatPostToolUseResponse", () => {
    it("context injection returns hookEventName and additionalContext in hookSpecificOutput", () => {
      const resp = adapter.formatPostToolUseResponse({
        additionalContext: "extra info",
      });
      const hso = (resp as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
      expect(hso.hookEventName).toBe("PostToolUse");
      expect(hso.additionalContext).toBe("extra info");
    });
  });

  // ── parseSessionStartInput ────────────────────────────

  describe("parseSessionStartInput", () => {
    it("extracts source field", () => {
      const event = adapter.parseSessionStartInput({
        session_id: "s1",
        cwd: "/proj",
        hook_event_name: "SessionStart",
        model: "o3",
        permission_mode: "default",
        source: "startup",
        transcript_path: null,
      });
      expect(event.source).toBe("startup");
    });

    it("extracts session_id", () => {
      const event = adapter.parseSessionStartInput({
        session_id: "codex-456",
        cwd: "/proj",
        hook_event_name: "SessionStart",
        model: "o3",
        permission_mode: "default",
        source: "resume",
        transcript_path: null,
      });
      expect(event.sessionId).toBe("codex-456");
    });
  });

  // ── formatSessionStartResponse ──────────────────────

  describe("formatSessionStartResponse", () => {
    it("context returns hookEventName and additionalContext in hookSpecificOutput", () => {
      const resp = adapter.formatSessionStartResponse({
        context: "routing block",
      });
      const hso = (resp as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
      expect(hso.hookEventName).toBe("SessionStart");
      expect(hso.additionalContext).toBe("routing block");
    });

    it("empty context returns empty object", () => {
      const resp = adapter.formatSessionStartResponse({});
      expect(resp).toEqual({});
    });
  });

  // ── Config paths ──────────────────────────────────────

  describe("config paths", () => {
    it("settings path ends with config.toml", () => {
      expect(adapter.getSettingsPath()).toContain("config.toml");
    });

    it("session dir is under ~/.codex/context-mode/sessions/", () => {
      expect(adapter.getSessionDir()).toContain(".codex");
      expect(adapter.getSessionDir()).toContain("sessions");
    });
  });

  // ── generateHookConfig ────────────────────────────────

  describe("generateHookConfig", () => {
    it("generates hooks.json with Codex-supported continuity entries", () => {
      const config = adapter.generateHookConfig("/path/to/plugin");
      expect(config).toHaveProperty("PreToolUse");
      expect(config).toHaveProperty("PostToolUse");
      expect(config).toHaveProperty("SessionStart");
      expect(config).toHaveProperty("UserPromptSubmit");
      expect(config).toHaveProperty("Stop");
    });

    it("matches OpenClaw Codex native tool names before routing runs", () => {
      const config = adapter.generateHookConfig("/path/to/plugin");
      const matcher = config.PreToolUse[0].matcher;

      for (const tool of ["exec", "read", "Read", "grep", "Grep", "search", "Search"]) {
        expect(matcher.split("|")).toContain(tool);
      }
    });
  });

  describe("validateHooks", () => {
    it("warns when a hook has duplicate managed context-mode entries", () => {
      mkdirSync(adapter.getConfigDir(), { recursive: true });
      writeFileSync(adapter.getSettingsPath(), "[features]\nhooks = true\n", "utf-8");
      const hooks = adapter.generateHookConfig("");
      hooks.PreToolUse = [
        hooks.PreToolUse[0],
        JSON.parse(JSON.stringify(hooks.PreToolUse[0])),
      ];
      writeFileSync(
        adapter.getHooksPath(),
        JSON.stringify({ hooks }, null, 2),
        "utf-8",
      );

      const results = adapter.validateHooks("");
      const duplicate = results.find((r) => r.check === "PreToolUse duplicates");

      expect(duplicate?.status).toBe("warn");
      expect(duplicate?.message).toContain("Codex will fire all of them");
      expect(duplicate?.fix).toContain("context-mode upgrade");
    });
  });
});

// ── Hook script integration tests ──────────────────────
describe("Codex pretooluse hook script", () => {
  it("outputs valid JSON with hookEventName even for passthrough (no routing match)", () => {
    const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      session_id: "test-1",
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      model: "o3",
      permission_mode: "default",
      tool_use_id: "tu1",
      transcript_path: null,
      turn_id: "t1",
    });

    const stdout = execFileSync(process.execPath, [hookScript], {
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });

  it("denies OpenClaw Codex exec rg with a ctx_execute replacement", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "exec",
        tool_input: { command: "rg TODO src" },
        session_id: "test-exec-rg",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("mcp__context_mode__.ctx_execute");
    });
  });

  it("denies OpenClaw Codex exec wrapping PowerShell search", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "exec",
        tool_input: { command: 'pwsh -NoProfile -Command "rg TODO src"' },
        session_id: "test-exec-pwsh",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("mcp__context_mode__.ctx_execute");
    });
  });

  it("denies OpenClaw Codex exec containing tools.shell_command", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "exec",
        tool_input: { command: 'tools.shell_command({"command":"rg TODO src"})' },
        session_id: "test-exec-wrapper",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("mcp__context_mode__.ctx_execute");
    });
  });

  it("denies uppercase OpenClaw Codex Search tool names", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "Search",
        tool_input: { pattern: "TODO", path: "src" },
        session_id: "test-search-uppercase",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("mcp__context_mode__.ctx_execute");
    });
  });

  it("denies OpenClaw Codex exec containing nested PowerShell shell wrapper", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "exec",
        tool_input: {
          command: 'tools.shell_command({"command":"pwsh -NoProfile -Command \\"rg TODO src\\""})',
        },
        session_id: "test-exec-wrapper-nested-pwsh",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("mcp__context_mode__.ctx_execute");
    });
  });

  it("allows OpenClaw Codex exec containing context-mode tool calls", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "exec",
        tool_input: { command: 'tools.mcp__context_mode__ctx_read({"path":"src/server.ts","mode":"outline"})' },
        session_id: "test-exec-context-mode",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(parsed.hookSpecificOutput.permissionDecision).toBeUndefined();
    });
  });

  it("denies context-mode wrapper text with a trailing noisy shell command", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "exec",
        tool_input: {
          command: 'tools.mcp__context_mode__ctx_read({"path":"src/server.ts","mode":"outline"}); rg TODO src',
        },
        session_id: "test-exec-context-mode-trailing-shell",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("mcp__context_mode__.ctx_execute");
    });
  });

  it("denies shell wrapper text with a trailing noisy shell command", () => {
    withMcpSentinel((env) => {
      const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
      const input = JSON.stringify({
        tool_name: "exec",
        tool_input: { command: 'tools.shell_command({"command":"echo ok"}); rg TODO src' },
        session_id: "test-exec-wrapper-trailing-shell",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      });

      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
        env,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("mcp__context_mode__.ctx_execute");
    });
  });
});

describe("Codex userpromptsubmit hook script", () => {
  it("outputs valid JSON with UserPromptSubmit hookEventName", () => {
    const hookScript = resolve(__dirname, "../../hooks/codex/userpromptsubmit.mjs");
    const input = JSON.stringify({
      session_id: "test-userprompt",
      cwd: "/tmp",
      hook_event_name: "UserPromptSubmit",
      model: "o3",
      permission_mode: "default",
      prompt: "remember this decision",
      transcript_path: null,
      turn_id: "t1",
    });

    const stdout = execFileSync(process.execPath, [hookScript], {
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });
});

describe("Codex stop hook script", () => {
  it("outputs valid JSON without requesting continuation", () => {
    const hookScript = resolve(__dirname, "../../hooks/codex/stop.mjs");
    const input = JSON.stringify({
      session_id: "test-stop",
      cwd: "/tmp",
      hook_event_name: "Stop",
      model: "o3",
      permission_mode: "default",
      last_assistant_message: "done",
      stop_hook_active: false,
      transcript_path: null,
      turn_id: "t1",
    });

    const stdout = execFileSync(process.execPath, [hookScript], {
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    expect(JSON.parse(stdout.trim())).toEqual({});
  });
});
