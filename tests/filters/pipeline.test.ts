import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER_PIPELINE,
  failureFocusFilter,
  redactSecretsFilter,
  redactText,
  runFilterPipeline,
  stripAnsiControlsFilter,
} from "../../src/filters/pipeline.js";
import type { FilterStep } from "../../src/filters/types.js";

describe("filter pipeline", () => {
  it("strips ANSI controls before failure extraction", () => {
    const result = runFilterPipeline(
      {
        command: "pnpm test",
        stdout: "\u001b[31mFAIL\u001b[0m src/auth.test.ts\nexpected 200 received 401",
        stderr: "",
        exitCode: 1,
        durationMs: 30,
      },
      [stripAnsiControlsFilter, failureFocusFilter],
    );

    expect(result.parseFailure).toBe(false);
    expect(result.stdout).toContain("FAIL src/auth.test.ts");
    expect(result.omitted.ansiControlBytes).toBeGreaterThan(0);
    expect(result.important.map((item) => item.message)).toContain("expected 200 received 401");
  });

  it("redacts secrets in stdout and stderr", () => {
    const result = runFilterPipeline(
      {
        command: "printenv",
        stdout: "API_KEY=super-secret-value ghp_abcdefghijklmnopqrstuvwxyz",
        stderr: "Authorization: Bearer abc.def.ghi",
        exitCode: 0,
        durationMs: 10,
      },
      [redactSecretsFilter],
    );

    expect(result.stdout).toContain("API_KEY=<redacted>");
    expect(result.stdout).toContain("<redacted>");
    expect(result.stderr).toBe("Authorization: Bearer <redacted>");
    expect(result.redactionCounts.generic_secret_assignment).toBe(1);
    expect(result.redactionCounts.github_token).toBe(1);
    expect(result.redactionCounts.authorization_header).toBe(1);
  });

  it("redacts common persisted sidecar secret shapes", () => {
    const result = redactText([
      "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
      "Set-Cookie: sid=secret; HttpOnly",
      "Cookie: sessionid=abc123",
      "x-api-key: header-secret",
      "sid=cookie-secret",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    ].join("\n"));

    expect(result.text).not.toContain("sk-proj-");
    expect(result.text).not.toContain("header-secret");
    expect(result.text).not.toContain("cookie-secret");
    expect(result.text).not.toContain("BEGIN PRIVATE KEY");
    expect(result.text).not.toContain("eyJhbGci");
    expect(result.counts.openai_token).toBe(1);
    expect(result.counts.cookie_header).toBe(2);
    expect(result.counts.api_key_header).toBe(1);
    expect(result.counts.common_cookie_assignment).toBe(1);
    expect(result.counts.jwt).toBe(1);
    expect(result.counts.private_key_block).toBe(1);
  });

  it("fails open when a filter throws", () => {
    const throwingStep: FilterStep = {
      name: "broken-parser",
      version: "1",
      run() {
        throw new Error("fixture parse error");
      },
    };

    const result = runFilterPipeline(
      {
        command: "pytest",
        stdout: "raw output is still available",
        stderr: "",
        exitCode: 1,
        durationMs: 5,
      },
      [throwingStep, failureFocusFilter],
    );

    expect(result.parseFailure).toBe(true);
    expect(result.failedStep).toBe("broken-parser");
    expect(result.stdout).toBe("raw output is still available");
    expect(result.diagnostics.join("\n")).toContain("fixture parse error");
  });

  it("keeps default pipeline critical-first and redacted", () => {
    const result = runFilterPipeline(
      {
        command: "npm test",
        stdout: "\u001b[31mERROR\u001b[0m expected true received false\nTOKEN=abc123",
        stderr: "timeout after 5000ms",
        exitCode: 1,
        durationMs: 99,
      },
      DEFAULT_FILTER_PIPELINE,
    );

    expect(result.stdout).toContain("ERROR expected true received false");
    expect(result.stdout).toContain("TOKEN=<redacted>");
    expect(result.important.map((item) => item.message)).toEqual([
      "ERROR expected true received false",
      "timeout after 5000ms",
    ]);
  });

  it("redactText can be used without the full pipeline", () => {
    const result = redactText("https://user:pass@example.com/path");

    expect(result.text).toBe("https://<user>:<redacted>@example.com/path");
    expect(result.counts.credentialed_url).toBe(1);
  });
});
