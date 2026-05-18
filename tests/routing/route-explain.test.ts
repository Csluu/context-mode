import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../src/routing/command-classifier.js";
import { explainRoute, routeCommand } from "../../src/routing/rewrite-registry.js";

describe("route explainability", () => {
  it("explains selected and rejected rules for an existing JSON reporter", () => {
    const decision = routeCommand("pnpm test --reporter=json", {
      mode: "recommend",
      adapterCanRewrite: true,
    });

    expect(decision.decision).toBe("recommend");
    expect(decision.selectedRule).toBe("node-test-existing-json-reporter");
    expect(decision.priority).toBe(88);
    expect(decision.confidence).toBeGreaterThan(0.9);
    expect(decision.route?.parser).toBe("vitest-json");
    expect(decision.rejectedRules.some((rule) => rule.rule === "node-test-generic")).toBe(true);
    expect(decision.safety.autoRewriteEligible).toBe(false);
    expect(decision.safety.reason).toContain("structured");
  });

  it("recognizes Windows npm shims, typecheck, OpenClaw, cargo, and graphify commands", () => {
    const cases = [
      { command: "npm.cmd run test:coverage", rule: "node-test-generic", parser: "node-test-generic" },
      { command: "npx.cmd vitest run --coverage", rule: "vitest-test", parser: "vitest" },
      { command: "npx.cmd playwright test", rule: "playwright-test", parser: "playwright" },
      { command: "npx.cmd tsx --test", rule: "node-test-generic", parser: "node-test-generic" },
      { command: "npm --prefix frontend test", rule: "node-test-generic", parser: "node-test-generic" },
      { command: "pnpm --filter web vitest run", rule: "vitest-test", parser: "vitest" },
      { command: "npm --prefix frontend run playwright:e2e", rule: "playwright-test", parser: "playwright" },
      { command: "npm.cmd run build", rule: "node-build-generic", parser: "generic-failure" },
      { command: "CI=1 npm --prefix frontend run build", rule: "node-build-generic", parser: "generic-failure" },
      { command: "npm --prefix frontend run build", rule: "node-build-generic", parser: "generic-failure" },
      { command: "npx.cmd tsc --noEmit", rule: "node-typecheck-generic", parser: "generic-failure" },
      { command: "CI=1 npx.cmd tsc --noEmit", rule: "node-typecheck-generic", parser: "generic-failure" },
      { command: "npm --prefix frontend run typecheck", rule: "node-typecheck-generic", parser: "generic-failure" },
      { command: "cargo test", rule: "cargo-test", parser: "generic-failure" },
      { command: "graphify query \"test coverage\"", rule: "graphify", parser: "generic-failure" },
      { command: "openclaw status --no-color", rule: "openclaw-status-logs", parser: "generic-failure" },
    ];

    for (const item of cases) {
      const decision = routeCommand(item.command, { mode: "recommend", adapterCanRewrite: true });

      expect(decision.decision).toBe("recommend");
      expect(decision.selectedRule).toBe(item.rule);
      expect(decision.route?.parser).toBe(item.parser);
      expect(decision.safety.reason).toContain("recommendation-only");
    }
  });

  it("routes structured test reporter output to structured parsers", () => {
    const vitest = routeCommand("npx.cmd vitest run --reporter=json", {
      mode: "recommend",
      adapterCanRewrite: true,
    });
    expect(vitest.selectedRule).toBe("node-test-existing-json-reporter");
    expect(vitest.route?.parser).toBe("vitest-json");

    const playwright = routeCommand("npx.cmd playwright test --reporter=json", {
      mode: "recommend",
      adapterCanRewrite: true,
    });
    expect(playwright.selectedRule).toBe("playwright-existing-json-reporter");
    expect(playwright.route?.parser).toBe("playwright-json");
  });

  it("keeps non-json Playwright reporters out of automatic text-parser rewrite", () => {
    const decision = routeCommand("npx.cmd playwright test --reporter=line", {
      mode: "rewrite",
      adapterCanRewrite: true,
    });

    expect(decision.selectedRule).toBe("playwright-test");
    expect(decision.route?.parser).toBe("playwright");
    expect(decision.safety.reason).toContain("--reporter");
    expect(decision.diagnostics).toContain("known flag conflict: --reporter");
  });

  it("does not treat dependency install commands as test commands", () => {
    const decision = routeCommand("npm.cmd install vitest", {
      mode: "recommend",
      adapterCanRewrite: true,
    });

    expect(decision.selectedRule).toBeUndefined();
    expect(decision.route).toBeUndefined();
    expect(decision.diagnostics).toContain("no matching rule");
  });

  it("classifies interactive and watch commands without rewrite", () => {
    const rebase = routeCommand("git rebase -i HEAD~3", {
      mode: "rewrite",
      adapterCanRewrite: true,
    });
    expect(rebase.decision).toBe("classify-only");
    expect(rebase.interactivity.requiresTty).toBe(true);
    expect(rebase.safety.autoRewriteEligible).toBe(false);

    const watch = routeCommand("npm run dev", {
      mode: "rewrite",
      adapterCanRewrite: true,
    });
    expect(watch.decision).toBe("classify-only");
    expect(watch.selectedRule).toBe("node-dev-server");
    expect(watch.route?.tool).toBe("ctx_execute");
    expect(watch.interactivity.isLongRunning).toBe(true);
  });

  it("marks stdin and heredoc commands as classify-only", () => {
    const pipe = routeCommand("cat .env | grep TOKEN", {
      mode: "rewrite",
      adapterCanRewrite: true,
    });
    expect(pipe.decision).toBe("classify-only");
    expect(pipe.input.stdinPresent).toBe(true);

    const heredoc = classifyCommand("node <<EOF\nconsole.log('x')\nEOF");
    expect(heredoc.input.heredocDetected).toBe(true);
    expect(heredoc.input.stdinPersisted).toBe(false);
  });

  it("does not treat quoted rg metacharacters as shell stdin or redirection", () => {
    const quotedPipe = routeCommand("rg -n \"ctx_gain|ctx_discover\" \"C:\\Users\\chris\\repo\\src\"", {
      mode: "recommend",
      adapterCanRewrite: true,
    });
    expect(quotedPipe.selectedRule).toBe("rg-search");
    expect(quotedPipe.input.stdinPresent).toBe(false);
    expect(quotedPipe.interactivity.usesStdin).toBe(false);
    expect(quotedPipe.interactivity.interactiveRisk).toBe("none");

    const quotedAngle = classifyCommand("rg \"<tool>\" src");
    expect(quotedAngle.input.stdinPresent).toBe(false);
    expect(quotedAngle.hasRedirection).toBe(false);
    expect(quotedAngle.segments[0]?.classificationOnly).toBe(false);

    const quotedSubshell = classifyCommand("echo \"$(pwd)\"");
    expect(quotedSubshell.hasSubshell).toBe(true);
    expect(quotedSubshell.segments[0]?.classificationOnly).toBe(true);
  });

  it("does not select a single-command route for compound commands", () => {
    for (const command of [
      "git status && npm.cmd run test:coverage",
      "rg foo & echo done",
      "rg foo\necho done",
    ]) {
      const decision = routeCommand(command, {
        mode: "rewrite",
        adapterCanRewrite: true,
      });

      expect(decision.decision).toBe("classify-only");
      expect(decision.selectedRule).toBeUndefined();
      expect(decision.safety.reason).toContain("compound");
      expect(decision.diagnostics?.[0]).toContain("compound command");
    }
  });

  it("adds segment route recommendations for safe compound command parts", () => {
    const decision = routeCommand("cd frontend && npx.cmd tsx --test", {
      mode: "recommend",
      adapterCanRewrite: false,
    });

    expect(decision.decision).toBe("classify-only");
    expect(decision.safety.reason).toContain("compound");
    expect(decision.segmentRoutes).toEqual([
      expect.objectContaining({
        segmentIndex: 1,
        command: "npx.cmd tsx --test",
        selectedRule: "node-test-generic",
        route: expect.objectContaining({
          tool: "ctx_execute",
          parser: "node-test-generic",
        }),
      }),
    ]);
    expect(decision.diagnostics).toContain("segment route recommendations available: 1");
  });

  it("honors Windows shell escape characters and fd redirection around separators", () => {
    const cmdEscapedPipe = classifyCommand("cmd.exe /c rg a^|b src");
    expect(cmdEscapedPipe.input.stdinPresent).toBe(false);
    expect(cmdEscapedPipe.hasCompoundOperators).toBe(false);
    expect(cmdEscapedPipe.segments).toHaveLength(1);

    const powershellEscapedPipe = classifyCommand("Write-Host `| done");
    expect(powershellEscapedPipe.input.stdinPresent).toBe(false);
    expect(powershellEscapedPipe.hasSubshell).toBe(false);
    expect(powershellEscapedPipe.hasCompoundOperators).toBe(false);

    const fdRedirect = classifyCommand("echo foo 2>&1");
    expect(fdRedirect.hasRedirection).toBe(true);
    expect(fdRedirect.hasCompoundOperators).toBe(false);
    expect(fdRedirect.segments).toHaveLength(1);
  });

  it("preserves Windows path backslashes in argv", () => {
    const classified = classifyCommand("rg \"foo\" \"C:\\Users\\chris\\repo\\src\"");
    expect(classified.argv[2]).toBe("C:\\Users\\chris\\repo\\src");
  });

  it("routes git status and diff when global git options precede the subcommand", () => {
    const cases = [
      {
        command: "git -C \"C:\\Users\\chris\\.openclaw\" diff -- openclaw.json",
        rule: "git-diff",
        parser: "git-diff",
      },
      {
        command: "git -c color.ui=always -C repo status --short",
        rule: "git-status",
        parser: "git-status",
      },
    ];

    for (const item of cases) {
      const decision = routeCommand(item.command, { mode: "recommend", adapterCanRewrite: true });

      expect(decision.decision).toBe("recommend");
      expect(decision.selectedRule).toBe(item.rule);
      expect(decision.route?.parser).toBe(item.parser);
      expect(decision.segments[0]?.hasSideEffects).toBe(false);
      expect(decision.segments[0]?.classificationOnly).toBe(false);
    }
  });

  it("treats read-only git subcommands with global options as side-effect free", () => {
    const commands = [
      "git -C repo diff -- README.md",
      "git -c color.ui=always status --short",
      "git --no-pager log --oneline",
      "git --git-dir=.git show HEAD",
    ];

    for (const command of commands) {
      const segment = classifyCommand(command).segments[0];

      expect(segment?.hasSideEffects).toBe(false);
      expect(segment?.classificationOnly).toBe(false);
    }
  });

  it("serializes stable JSON for ctx route --explain", () => {
    const parsed = JSON.parse(explainRoute("git diff"));
    expect(parsed.selectedRule).toBe("git-diff");
    expect(parsed.route.tool).toBe("ctx_execute");
    expect(parsed.safety.reason).toContain("recommendation-only");
  });

  it("redacts secret-looking flag values from route explanations", () => {
    const text = explainRoute("rg --token sk-proj-abcdefghijklmnopqrstuvwxyz src");
    const parsed = JSON.parse(text);

    expect(text).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    expect(parsed.route.command).toContain("--token <redacted>");
    expect(parsed.segments[0].rawShape).toContain("--token <redacted>");
  });

  it("passes through when the router is disabled", () => {
    const decision = routeCommand("git diff", {
      mode: "off",
      adapterCanRewrite: true,
    });

    expect(decision.decision).toBe("pass-through");
    expect(decision.selectedRule).toBe("git-diff");
    expect(decision.safety.reason).toBe("router mode is off");
  });

  it("routes curl and wget through fetch policy without auto rewrite", () => {
    for (const command of ["curl https://example.com", "wget https://example.com/file"]) {
      const decision = routeCommand(command, { mode: "rewrite", adapterCanRewrite: true });

      expect(decision.selectedRule).toBe("network-fetch-classify-only");
      expect(decision.decision).toBe("recommend");
      expect(decision.route?.tool).toBe("ctx_fetch_and_index");
      expect(decision.safety.reason).toContain("danger level high");
    }
  });

  it("does not rewrite commands with known flag conflicts", () => {
    const cases = [
      { command: "rg --files src", rule: "rg-search", reason: "--files" },
      { command: "git status --porcelain=v2", rule: "git-status", reason: "--porcelain=v2" },
      { command: "grep -z TODO file.txt", rule: "grep-search", reason: "-z" },
    ];

    for (const item of cases) {
      const decision = routeCommand(item.command, {
        mode: "rewrite",
        adapterCanRewrite: true,
      });

      expect(decision.decision).toBe("recommend");
      expect(decision.selectedRule).toBe(item.rule);
      expect(decision.safety.autoRewriteEligible).toBe(false);
      expect(decision.safety.reason).toContain(item.reason);
    }
  });
});
