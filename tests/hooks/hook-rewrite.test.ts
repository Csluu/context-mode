import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initRewriteRegistry, routePreToolUse, resetGuidanceThrottle } from "../../hooks/core/routing.mjs";

const OLD_ROUTER_MODE = process.env.CONTEXT_MODE_ROUTER_MODE;
const OLD_CTX_MODE_ROUTER = process.env.CTX_MODE_ROUTER;
const OLD_HOOK_REWRITE = process.env.CONTEXT_MODE_HOOK_REWRITE;
const OLD_EXPERIMENTAL = process.env.CONTEXT_MODE_EXPERIMENTAL_HOOK_REWRITE;
const OLD_RAW = process.env.CONTEXT_MODE_RAW;

const STABLE_MUTATION_ADAPTERS = [
  "claude-code",
  "cursor",
  "openclaw",
  "opencode",
  "vscode-copilot",
];

const EXPERIMENTAL_MUTATION_ADAPTERS = [
  "gemini-cli",
  "jetbrains-copilot",
  "qwen-code",
];

const UNSUPPORTED_MUTATION_ADAPTERS = [
  "antigravity",
  "codex",
  "kiro",
  "kilo",
  "omp",
  "pi",
  "zed",
];

beforeAll(async () => {
  expect(await initRewriteRegistry()).toBe(true);
});

function restoreEnv(): void {
  if (OLD_ROUTER_MODE === undefined) delete process.env.CONTEXT_MODE_ROUTER_MODE;
  else process.env.CONTEXT_MODE_ROUTER_MODE = OLD_ROUTER_MODE;
  if (OLD_CTX_MODE_ROUTER === undefined) delete process.env.CTX_MODE_ROUTER;
  else process.env.CTX_MODE_ROUTER = OLD_CTX_MODE_ROUTER;
  if (OLD_HOOK_REWRITE === undefined) delete process.env.CONTEXT_MODE_HOOK_REWRITE;
  else process.env.CONTEXT_MODE_HOOK_REWRITE = OLD_HOOK_REWRITE;
  if (OLD_EXPERIMENTAL === undefined) delete process.env.CONTEXT_MODE_EXPERIMENTAL_HOOK_REWRITE;
  else process.env.CONTEXT_MODE_EXPERIMENTAL_HOOK_REWRITE = OLD_EXPERIMENTAL;
  if (OLD_RAW === undefined) delete process.env.CONTEXT_MODE_RAW;
  else process.env.CONTEXT_MODE_RAW = OLD_RAW;
}

afterEach(() => {
  restoreEnv();
  resetGuidanceThrottle("hook-rewrite-test");
});

describe("hook-side command routing", () => {
  it("recommends registry routes by default without mutating Bash input", () => {
    delete process.env.CONTEXT_MODE_ROUTER_MODE;
    delete process.env.CONTEXT_MODE_HOOK_REWRITE;
    resetGuidanceThrottle("hook-rewrite-default");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      "claude-code",
      "hook-rewrite-default",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("Recommended route");
    expect(decision?.additionalContext).toContain("parser=\"rg\"");
  });

  it("rewrites low-risk allowlisted commands through the CLI run wrapper when explicitly enabled", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    resetGuidanceThrottle("hook-rewrite-enabled");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      "claude-code",
      "hook-rewrite-enabled",
    );

    expect(decision?.action).toBe("modify");
    expect(decision?.updatedInput?.command).toContain("cli.bundle.mjs");
    expect(decision?.updatedInput?.command).toContain("'run'");
    expect(decision?.updatedInput?.command).toContain("'--parser'");
    expect(decision?.updatedInput?.command).toContain("'rg'");
    expect(decision?.updatedInput?.command).toContain("'TODO'");
    expect(decision?.updatedInput?.command).toContain("'src'");
    expect(decision?.redirectMeta).toMatchObject({
      tool: "Bash",
      type: "bash-rewritten",
    });
  });

  it("rewrites when CONTEXT_MODE_ROUTER_MODE=rewrite is explicitly set", () => {
    delete process.env.CONTEXT_MODE_HOOK_REWRITE;
    process.env.CONTEXT_MODE_ROUTER_MODE = "rewrite";
    resetGuidanceThrottle("hook-router-mode-rewrite");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      "claude-code",
      "hook-router-mode-rewrite",
    );

    expect(decision?.action).toBe("modify");
    expect(decision?.updatedInput?.command).toContain("'run'");
    expect(decision?.updatedInput?.command).toContain("'rg'");
    expect(decision?.updatedInput?.command).toContain("'TODO'");
    expect(decision?.updatedInput?.command).toContain("'src'");
  });

  it("preserves quoted command arguments as argv under hook rewrite", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    resetGuidanceThrottle("hook-rewrite-quoted-argv");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg 'context-mode' package.json" },
      "/repo",
      "claude-code",
      "hook-rewrite-quoted-argv",
    );

    expect(decision?.action).toBe("modify");
    expect(decision?.updatedInput?.command).toContain("'rg'");
    expect(decision?.updatedInput?.command).toContain("'context-mode'");
    expect(decision?.updatedInput?.command).toContain("'package.json'");
    expect(decision?.updatedInput?.command).not.toContain("'rg '\"'\"'context-mode'\"'\"' package.json'");
  });

  it("honors CTX_MODE_ROUTER=off as the documented rewrite kill switch", () => {
    delete process.env.CONTEXT_MODE_HOOK_REWRITE;
    delete process.env.CONTEXT_MODE_ROUTER_MODE;
    process.env.CTX_MODE_ROUTER = "off";
    resetGuidanceThrottle("hook-router-mode-off-alias");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      "claude-code",
      "hook-router-mode-off-alias",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("May produce large output");
    expect(decision?.additionalContext).not.toContain("Recommended route");
  });

  it("lets CTX_MODE_ROUTER=off override the legacy rewrite flag", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    delete process.env.CONTEXT_MODE_ROUTER_MODE;
    process.env.CTX_MODE_ROUTER = "off";
    resetGuidanceThrottle("hook-router-off-overrides-legacy-rewrite");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      "claude-code",
      "hook-router-off-overrides-legacy-rewrite",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("May produce large output");
    expect(decision?.additionalContext).not.toContain("Recommended route");
  });

  it("does not rewrite recommendation-only rules even in rewrite mode", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    resetGuidanceThrottle("hook-rewrite-recommend-only");

    const decision = routePreToolUse(
      "Bash",
      { command: "git diff" },
      "/repo",
      "claude-code",
      "hook-rewrite-recommend-only",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("git-diff");
    expect(decision?.additionalContext).toContain("recommendation-only");
  });

  it("does not mutate adapters without proven input-rewrite support", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    resetGuidanceThrottle("hook-rewrite-codex");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      "codex",
      "hook-rewrite-codex",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("adapter cannot rewrite");
  });

  it("fails closed when adapter identity is missing", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    resetGuidanceThrottle("hook-rewrite-missing-adapter");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      undefined,
      "hook-rewrite-missing-adapter",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("adapter cannot rewrite");
  });

  it("does not rewrite commands with known route flag conflicts", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    resetGuidanceThrottle("hook-rewrite-flag-conflict");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg --files src" },
      "/repo",
      "claude-code",
      "hook-rewrite-flag-conflict",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("known flag conflict");
    expect(decision?.additionalContext).toContain("--files");
  });

  it.each(STABLE_MUTATION_ADAPTERS)(
    "rewrites low-risk commands for stable mutation adapter %s when explicitly enabled",
    (adapter) => {
      process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
      const sessionId = `hook-rewrite-stable-${adapter}`;
      resetGuidanceThrottle(sessionId);

      const decision = routePreToolUse(
        "Bash",
        { command: "rg TODO src" },
        "/repo",
        adapter,
        sessionId,
      );

      expect(decision?.action).toBe("modify");
      expect(decision?.updatedInput?.command).toContain("cli.bundle.mjs");
      expect(decision?.updatedInput?.command).toContain("'run'");
      expect(decision?.updatedInput?.command).toContain("'rg'");
      expect(decision?.updatedInput?.command).toContain("'TODO'");
      expect(decision?.updatedInput?.command).toContain("'src'");
    },
  );

  it.each(EXPERIMENTAL_MUTATION_ADAPTERS)(
    "keeps experimental mutation adapter %s recommendation-only without experimental flag",
    (adapter) => {
      process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
      delete process.env.CONTEXT_MODE_EXPERIMENTAL_HOOK_REWRITE;
      const sessionId = `hook-rewrite-experimental-off-${adapter}`;
      resetGuidanceThrottle(sessionId);

      const decision = routePreToolUse(
        "Bash",
        { command: "rg TODO src" },
        "/repo",
        adapter,
        sessionId,
      );

      expect(decision?.action).toBe("context");
      expect(decision?.additionalContext).toContain("adapter cannot rewrite");
    },
  );

  it.each(EXPERIMENTAL_MUTATION_ADAPTERS)(
    "rewrites low-risk commands for experimental mutation adapter %s when explicitly opted in",
    (adapter) => {
      process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
      process.env.CONTEXT_MODE_EXPERIMENTAL_HOOK_REWRITE = "1";
      const sessionId = `hook-rewrite-experimental-on-${adapter}`;
      resetGuidanceThrottle(sessionId);

      const decision = routePreToolUse(
        "Bash",
        { command: "rg TODO src" },
        "/repo",
        adapter,
        sessionId,
      );

      expect(decision?.action).toBe("modify");
      expect(decision?.updatedInput?.command).toContain("cli.bundle.mjs");
      expect(decision?.updatedInput?.command).toContain("'run'");
      expect(decision?.updatedInput?.command).toContain("'rg'");
      expect(decision?.updatedInput?.command).toContain("'TODO'");
      expect(decision?.updatedInput?.command).toContain("'src'");
    },
  );

  it.each(UNSUPPORTED_MUTATION_ADAPTERS)(
    "does not mutate unsupported adapter %s even in rewrite mode",
    (adapter) => {
      process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
      process.env.CONTEXT_MODE_EXPERIMENTAL_HOOK_REWRITE = "1";
      const sessionId = `hook-rewrite-unsupported-${adapter}`;
      resetGuidanceThrottle(sessionId);

      const decision = routePreToolUse(
        "Bash",
        { command: "rg TODO src" },
        "/repo",
        adapter,
        sessionId,
      );

      expect(decision?.action).toBe("context");
      expect(decision?.additionalContext).toContain("adapter cannot rewrite");
    },
  );

  it("raw mode disables hook rewrite even for stable mutation adapters", () => {
    process.env.CONTEXT_MODE_HOOK_REWRITE = "1";
    process.env.CONTEXT_MODE_RAW = "1";
    resetGuidanceThrottle("hook-rewrite-raw");

    const decision = routePreToolUse(
      "Bash",
      { command: "rg TODO src" },
      "/repo",
      "claude-code",
      "hook-rewrite-raw",
    );

    expect(decision?.action).toBe("context");
    expect(decision?.additionalContext).toContain("May produce large output");
    expect(decision?.additionalContext).not.toContain("Recommended route");
  });
});
