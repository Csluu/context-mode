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

  it("preserves quote style for generic secret assignments", () => {
    const result = redactText([
      "TOKEN=\"quoted-secret-value\"",
      "API_KEY='single-quoted-secret'",
      "PASSWORD=bare-secret",
    ].join("\n"));

    expect(result.text).toContain("TOKEN=\"<redacted>\"");
    expect(result.text).toContain("API_KEY='<redacted>'");
    expect(result.text).toContain("PASSWORD=<redacted>");
    expect(result.counts.generic_secret_assignment).toBe(3);
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

  it("keeps the tail of long failure streams", () => {
    const result = runFilterPipeline(
      {
        command: "npm test",
        stdout: Array.from({ length: 30 }, (_, i) => `Error early failure ${i}`).join("\n"),
        stderr: "Final exception root cause",
        exitCode: 1,
        durationMs: 99,
      },
      [failureFocusFilter],
    );

    expect(result.important).toHaveLength(25);
    expect(result.important.map((item) => item.message)).not.toContain("Error early failure 0");
    expect(result.important.at(-1)?.message).toBe("Final exception root cause");
  });

  it("redactText can be used without the full pipeline", () => {
    const result = redactText("https://user:pass@example.com/path");

    expect(result.text).toBe("https://<user>:<redacted>@example.com/path");
    expect(result.counts.credentialed_url).toBe(1);
  });

  it("does not redact harmless source code that mentions header patterns mid-line", () => {
    const source = [
      "const cookiePattern = /Cookie:\\s*[^\\r\\n]+/gi;",
      "const authExample = \"Authorization: Bearer token-shape-in-docs\";",
      "const apiKeyHeader = /x-api-key:\\s*[^\\r\\n]+/gi;",
      "max_tokens: z.number().optional(),",
    ].join("\n");

    const result = redactText(source);

    expect(result.text).toContain("Cookie:\\s*");
    expect(result.text).toContain("Authorization: Bearer token-shape-in-docs");
    expect(result.text).toContain("x-api-key:\\s*");
    expect(result.text).toContain("max_tokens");
    expect(result.counts.cookie_header).toBeUndefined();
    expect(result.counts.authorization_header).toBeUndefined();
    expect(result.counts.api_key_header).toBeUndefined();
  });
});
