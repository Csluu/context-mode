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
