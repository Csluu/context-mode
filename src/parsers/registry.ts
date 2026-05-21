import type { OutputParser, ParsedImportantItem, ParsedOutput, ParserConfidence, ParserInput } from "./types.js";

export interface RenderParsedOutputOptions {
  readonly maxImportantItems?: number;
}

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function parserConfidence(score: number, reason: string): ParserConfidence {
  const clamped = Math.max(0, Math.min(1, score));
  return {
    score: clamped,
    level: clamped >= 0.8 ? "high" : clamped >= 0.5 ? "medium" : "low",
    reason,
  };
}

function linesOf(input: ParserInput): string[] {
  return `${stripAnsi(input.stdout)}\n${stripAnsi(input.stderr)}`.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function unwrapStructuredOutput(input: ParserInput): ParserInput {
  const text = input.stdout.trim();
  if (!text.startsWith("{")) return input;
  try {
    const parsed = JSON.parse(text) as {
      stdout?: unknown;
      stderr?: unknown;
      status?: unknown;
      exitCode?: unknown;
    };
    const stdout = typeof parsed.stdout === "string" ? parsed.stdout : input.stdout;
    const stderr = typeof parsed.stderr === "string" ? parsed.stderr : input.stderr;
    const exitCode = typeof parsed.exitCode === "number"
      ? parsed.exitCode
      : typeof parsed.status === "number"
        ? parsed.status
        : input.exitCode;
    return { ...input, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), exitCode };
  } catch {
    return input;
  }
}

function failureLines(input: ParserInput, limit = 25): ParsedImportantItem[] {
  return linesOf(input)
    .map((line) => line.trim())
    .filter((line) => /\b(error|failed|failure|exception|timeout|expected|received|fatal|traceback)\b/i.test(line))
    .slice(0, limit)
    .map((message) => {
      const loc = message.match(/\b([^:\s]+\.[A-Za-z0-9]+):(\d+)\b/);
      return loc
        ? { file: loc[1], line: Number(loc[2]), message }
        : { message };
    });
}

function statusFromExit(exitCode: number) {
  return exitCode === 0 ? "succeeded" as const : "failed" as const;
}

function countStatus(text: string, status: string): number {
  const match = text.match(new RegExp(`(\\d+)\\s+${status}\\b`, "i"));
  return match ? Number(match[1]) : 0;
}

function compactCounts(label: string, line: string | undefined): string | undefined {
  if (!line) return undefined;
  const passed = countStatus(line, "passed");
  const failed = countStatus(line, "failed");
  const skipped = countStatus(line, "skipped");
  const todo = countStatus(line, "todo");
  const total = passed + failed + skipped + todo;
  const parts = [
    failed > 0 ? `${failed} failed` : "",
    passed > 0 ? `${passed} passed` : "",
    skipped > 0 ? `${skipped} skipped` : "",
    todo > 0 ? `${todo} todo` : "",
  ].filter(Boolean);
  if (parts.length === 0) return undefined;
  return `${label}: ${parts.join(", ")}${total > 0 ? ` (${total})` : ""}`;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseJsonPayload(input: ParserInput): unknown | null {
  for (const text of [input.stdout.trim(), input.stderr.trim(), `${input.stdout}\n${input.stderr}`.trim()]) {
    if (!text.startsWith("{") && !text.startsWith("[")) continue;
    try {
      return JSON.parse(text);
    } catch {
      continue;
    }
  }
  return null;
}

function compactAggregate(label: string, counts: { failed?: number; flaky?: number; passed?: number; skipped?: number; todo?: number }): string | undefined {
  const failed = counts.failed ?? 0;
  const flaky = counts.flaky ?? 0;
  const passed = counts.passed ?? 0;
  const skipped = counts.skipped ?? 0;
  const todo = counts.todo ?? 0;
  const total = failed + flaky + passed + skipped + todo;
  const parts = [
    failed > 0 ? `${failed} failed` : "",
    flaky > 0 ? `${flaky} flaky` : "",
    passed > 0 ? `${passed} passed` : "",
    skipped > 0 ? `${skipped} skipped` : "",
    todo > 0 ? `${todo} todo` : "",
  ].filter(Boolean);
  if (parts.length === 0) return undefined;
  return `${label}: ${parts.join(", ")}${total > 0 ? ` (${total})` : ""}`;
}

function collectStatusCounts(value: unknown, counts: Record<string, number>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStatusCounts(item, counts);
    return;
  }
  const object = value as Record<string, unknown>;
  const status = typeof object.status === "string" ? object.status.toLowerCase() : "";
  if (status) counts[status] = (counts[status] ?? 0) + 1;
  for (const child of Object.values(object)) collectStatusCounts(child, counts);
}

function collectJsonFailureMessages(value: unknown, out: ParsedImportantItem[]): void {
  if (out.length >= 25 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonFailureMessages(item, out);
    return;
  }
  const object = value as Record<string, unknown>;
  const message = typeof object.failureMessage === "string"
    ? object.failureMessage
    : typeof object.message === "string"
      ? object.message
      : typeof object.error === "object" && object.error && typeof (object.error as { message?: unknown }).message === "string"
        ? String((object.error as { message?: unknown }).message)
        : "";
  if (message && /\b(error|failed|failure|expected|received|timeout)\b/i.test(message)) {
    out.push({ message: message.split(/\r?\n/)[0] ?? message });
  }
  for (const child of Object.values(object)) collectJsonFailureMessages(child, out);
}

function itemFromLocation(message: string): ParsedImportantItem {
  const tsLoc = message.match(/^(.+?)\((\d+),(\d+)\):\s*(.*)$/);
  if (tsLoc) {
    return { file: tsLoc[1], line: Number(tsLoc[2]), message };
  }
  const colonLoc = message.match(/^((?:[A-Za-z]:\\)?[^:\n]+?\.[A-Za-z0-9]+):(\d+)(?::\d+)?:?\s*(.*)$/);
  if (colonLoc) {
    return { file: colonLoc[1], line: Number(colonLoc[2]), message };
  }
  return { message };
}

function compactStatusParts(counts: Record<string, number>, order: readonly string[]): string {
  return order
    .map((key) => (counts[key] ? `${counts[key]} ${key}` : ""))
    .filter(Boolean)
    .join(", ");
}

const vitestJsonParser: OutputParser = {
  name: "vitest-json",
  aliases: ["vitest-reporter-json"],
  parse(input) {
    const payload = parseJsonPayload(input);
    if (!payload || typeof payload !== "object") {
      return {
        parser: "vitest-json",
        status: statusFromExit(input.exitCode),
        summary: `exit ${input.exitCode}`,
        important: failureLines(input),
        confidence: parserConfidence(0.35, "Vitest JSON payload not found"),
      };
    }
    const object = payload as Record<string, unknown>;
    const fileSummary = compactAggregate("files", {
      failed: numberField(object.numFailedTestSuites),
      passed: numberField(object.numPassedTestSuites),
      skipped: numberField(object.numPendingTestSuites),
    });
    const testSummary = compactAggregate("tests", {
      failed: numberField(object.numFailedTests),
      passed: numberField(object.numPassedTests),
      skipped: numberField(object.numPendingTests),
      todo: numberField(object.numTodoTests),
    });
    const summaries = [fileSummary, testSummary].filter((item): item is string => Boolean(item));
    const important: ParsedImportantItem[] = [];
    collectJsonFailureMessages(payload, important);
    return {
      parser: "vitest-json",
      status: statusFromExit(input.exitCode),
      summary: summaries.length > 0 ? summaries.join("; ") : `exit ${input.exitCode}`,
      important: input.exitCode === 0 ? [] : important.slice(0, 25),
      confidence: parserConfidence(
        summaries.length > 0 ? 0.9 : 0.55,
        summaries.length > 0 ? "Vitest JSON counters parsed" : "JSON parsed but Vitest counters not found",
      ),
    };
  },
};

const vitestParser: OutputParser = {
  name: "vitest",
  parse(input) {
    const lines = linesOf(input);
    const testFiles = lines.find((line) => /^\s*Test Files\s+/i.test(line));
    const tests = lines.find((line) => /^\s*Tests\s+/i.test(line));
    const summaries = [
      compactCounts("files", testFiles),
      compactCounts("tests", tests),
    ].filter((item): item is string => Boolean(item));
    const important = input.exitCode === 0
      ? []
      : failureLines(input).concat(
        lines
          .filter((line) => /^\s*(FAIL|Failed Tests|Error:)\b/i.test(line))
          .slice(0, 10)
          .map((message) => ({ message: message.trim() })),
      ).slice(0, 25);
    return {
      parser: "vitest",
      status: statusFromExit(input.exitCode),
      summary: summaries.length > 0 ? summaries.join("; ") : `exit ${input.exitCode}`,
      important,
      confidence: parserConfidence(
        summaries.length > 0 ? 0.9 : 0.58,
        summaries.length > 0 ? "Vitest summary counters parsed" : "exit code known but Vitest counters not found",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const playwrightJsonParser: OutputParser = {
  name: "playwright-json",
  aliases: ["playwright-reporter-json"],
  parse(input) {
    const payload = parseJsonPayload(input);
    if (!payload || typeof payload !== "object") {
      return {
        parser: "playwright-json",
        status: statusFromExit(input.exitCode),
        summary: `exit ${input.exitCode}`,
        important: failureLines(input),
        confidence: parserConfidence(0.35, "Playwright JSON payload not found"),
      };
    }
    const stats = (payload as { stats?: unknown }).stats as Record<string, unknown> | undefined;
    let failed = numberField(stats?.unexpected) + numberField(stats?.failed);
    let flaky = numberField(stats?.flaky);
    let passed = numberField(stats?.expected) + numberField(stats?.passed);
    let skipped = numberField(stats?.skipped);
    if (failed + flaky + passed + skipped === 0) {
      const counts: Record<string, number> = {};
      collectStatusCounts(payload, counts);
      failed = (counts.failed ?? 0) + (counts.timedout ?? 0) + (counts.interrupted ?? 0) + (counts.unexpected ?? 0);
      flaky = counts.flaky ?? 0;
      passed = (counts.passed ?? 0) + (counts.expected ?? 0);
      skipped = counts.skipped ?? 0;
    }
    const summary = compactAggregate("tests", { failed, flaky, passed, skipped });
    const important: ParsedImportantItem[] = [];
    collectJsonFailureMessages(payload, important);
    return {
      parser: "playwright-json",
      status: statusFromExit(input.exitCode),
      summary: summary ?? `exit ${input.exitCode}`,
      important: input.exitCode === 0 ? [] : important.slice(0, 25),
      confidence: parserConfidence(
        summary ? 0.88 : 0.55,
        summary ? "Playwright JSON counters parsed" : "JSON parsed but Playwright counters not found",
      ),
    };
  },
};

const playwrightParser: OutputParser = {
  name: "playwright",
  aliases: ["playwright-test"],
  parse(input) {
    const lines = linesOf(input);
    const summaryLines = lines.filter((line) =>
      /\b\d+\s+(failed|passed|skipped|flaky)\b/i.test(line)
    );
    const failed = summaryLines.reduce((sum, line) => sum + countStatus(line, "failed"), 0);
    const passed = summaryLines.reduce((sum, line) => sum + countStatus(line, "passed"), 0);
    const skipped = summaryLines.reduce((sum, line) => sum + countStatus(line, "skipped"), 0);
    const flaky = summaryLines.reduce((sum, line) => sum + countStatus(line, "flaky"), 0);
    const parts = [
      failed > 0 ? `${failed} failed` : "",
      flaky > 0 ? `${flaky} flaky` : "",
      passed > 0 ? `${passed} passed` : "",
      skipped > 0 ? `${skipped} skipped` : "",
    ].filter(Boolean);
    const important = input.exitCode === 0
      ? []
      : failureLines(input).concat(
        lines
          .filter((line) => /^\s*(Error:|TimeoutError:|\d+\)\s+)/i.test(line))
          .slice(0, 10)
          .map((message) => ({ message: message.trim() })),
      ).slice(0, 25);
    return {
      parser: "playwright",
      status: statusFromExit(input.exitCode),
      summary: parts.length > 0 ? parts.join(", ") : `exit ${input.exitCode}`,
      important,
      confidence: parserConfidence(
        parts.length > 0 ? 0.88 : 0.56,
        parts.length > 0 ? "Playwright summary counters parsed" : "exit code known but Playwright counters not found",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const pytestParser: OutputParser = {
  name: "pytest",
  aliases: ["pytest-output"],
  parse(input) {
    const lines = linesOf(input);
    const summaryLine = [...lines].reverse().find((line) =>
      /\b\d+\s+(?:failed|passed|skipped|xfailed|xpassed|errors?|warnings?)\b/i.test(line)
    );
    const counts: Record<string, number> = {};
    if (summaryLine) {
      for (const match of summaryLine.matchAll(/(\d+)\s+(failed|passed|skipped|xfailed|xpassed|errors?|warnings?)\b/gi)) {
        const key = match[2].toLowerCase().replace(/s$/, "");
        counts[key === "error" ? "failed" : key] = (counts[key === "error" ? "failed" : key] ?? 0) + Number(match[1]);
      }
    }
    const important = input.exitCode === 0
      ? []
      : lines
        .filter((line) => /^(FAILED|ERROR)\s+|::|E\s+AssertionError|Traceback\b/i.test(line.trim()))
        .slice(0, 25)
        .map((line) => itemFromLocation(line.trim()));
    if (!summaryLine && important.length > 0) counts.failed = important.length;
    const summary = compactStatusParts(counts, ["failed", "passed", "skipped", "xfailed", "xpassed", "warning"]);
    return {
      parser: "pytest",
      status: statusFromExit(input.exitCode),
      summary: summary || `exit ${input.exitCode}`,
      important,
      confidence: parserConfidence(
        summary ? 0.88 : important.length > 0 ? 0.72 : 0.58,
        summary ? "pytest terminal summary parsed" : important.length > 0 ? "pytest failure lines parsed" : "exit code known but pytest summary not found",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const tscParser: OutputParser = {
  name: "tsc",
  aliases: ["typescript", "typescript-compiler"],
  parse(input) {
    const lines = linesOf(input);
    const diagnosticLines = lines.filter((line) => /\berror\s+TS\d+:/i.test(line));
    const reported = [...lines].reverse().find((line) => /\bFound\s+\d+\s+errors?\b/i.test(line));
    const reportedCount = Number(reported?.match(/\bFound\s+(\d+)\s+errors?\b/i)?.[1] ?? diagnosticLines.length);
    const codes = new Map<string, number>();
    for (const line of diagnosticLines) {
      const code = line.match(/\b(TS\d+):/)?.[1];
      if (code) codes.set(code, (codes.get(code) ?? 0) + 1);
    }
    const codeSummary = Array.from(codes.entries()).slice(0, 6).map(([code, count]) => `${code}=${count}`).join(", ");
    const important = diagnosticLines.slice(0, 25).map((line) => itemFromLocation(line.trim()));
    return {
      parser: "tsc",
      status: statusFromExit(input.exitCode),
      summary: reportedCount > 0
        ? `errors=${reportedCount}${codeSummary ? ` (${codeSummary})` : ""}`
        : `exit ${input.exitCode}`,
      important,
      confidence: parserConfidence(
        diagnosticLines.length > 0 || reported ? 0.91 : 0.58,
        diagnosticLines.length > 0 ? "TypeScript diagnostic lines parsed" : "exit code known but TypeScript diagnostics not found",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const eslintParser: OutputParser = {
  name: "eslint",
  aliases: ["eslint-json", "eslint-stylish"],
  parse(input) {
    const payload = parseJsonPayload(input);
    const important: ParsedImportantItem[] = [];
    let errors = 0;
    let warnings = 0;
    if (Array.isArray(payload)) {
      for (const fileResult of payload as Array<Record<string, unknown>>) {
        const filePath = typeof fileResult.filePath === "string" ? fileResult.filePath : undefined;
        errors += numberField(fileResult.errorCount);
        warnings += numberField(fileResult.warningCount);
        const messages = Array.isArray(fileResult.messages) ? fileResult.messages : [];
        for (const item of messages as Array<Record<string, unknown>>) {
          if (important.length >= 25) break;
          const severity = numberField(item.severity);
          const message = typeof item.message === "string" ? item.message : "ESLint issue";
          const rule = typeof item.ruleId === "string" ? ` (${item.ruleId})` : "";
          important.push({
            file: filePath,
            line: numberField(item.line) || undefined,
            message: `${severity === 2 ? "error" : "warning"}: ${message}${rule}`,
          });
        }
      }
    } else {
      const lines = linesOf(input);
      let currentFile: string | undefined;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\/|^[A-Za-z]:\\|^[^:\s]+\.[A-Za-z0-9]+$/.test(trimmed) && !/^\d+:\d+/.test(trimmed)) {
          currentFile = trimmed;
          continue;
        }
        const match = trimmed.match(/^(\d+):(\d+)\s+(error|warning)\s+(.+)$/i);
        if (!match) continue;
        if (match[3].toLowerCase() === "error") errors++;
        else warnings++;
        if (important.length < 25) {
          important.push({
            file: currentFile,
            line: Number(match[1]),
            message: `${match[3].toLowerCase()}: ${match[4]}`,
          });
        }
      }
      const totals = lines.find((line) => /\bproblems?\b.*\berrors?\b/i.test(line));
      if (totals) {
        errors = Number(totals.match(/(\d+)\s+errors?\b/i)?.[1] ?? errors);
        warnings = Number(totals.match(/(\d+)\s+warnings?\b/i)?.[1] ?? warnings);
      }
    }
    const problemParts = [
      errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : "",
      warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return {
      parser: "eslint",
      status: statusFromExit(input.exitCode),
      summary: problemParts.length > 0 ? `problems: ${problemParts.join(", ")} (${errors + warnings})` : `exit ${input.exitCode}`,
      important: input.exitCode === 0 ? [] : important,
      confidence: parserConfidence(
        errors + warnings > 0 ? 0.9 : 0.58,
        errors + warnings > 0 ? "ESLint issue counts parsed" : "exit code known but ESLint issues not found",
      ),
      omitted: { totalLines: linesOf(input).length },
    };
  },
};

const npmParser: OutputParser = {
  name: "npm",
  aliases: ["npm-output", "npm-script"],
  parse(input) {
    const lines = linesOf(input);
    const npmErrors = lines.filter((line) => /^\s*npm\s+(ERR!|error)\b/i.test(line));
    const lifecycle = lines.find((line) => /\bELIFECYCLE\b|\bCommand failed\b|\bscript failed\b/i.test(line));
    const important = input.exitCode === 0
      ? []
      : npmErrors.concat(failureLines(input).map((item) => item.message)).slice(0, 25).map((message) => itemFromLocation(message.trim()));
    const code = lines.find((line) => /^\s*npm\s+(ERR!|error)\s+code\s+/i.test(line))?.trim();
    return {
      parser: "npm",
      status: statusFromExit(input.exitCode),
      summary: input.exitCode === 0
        ? `exit 0`
        : `${code ? `${code}; ` : ""}${important.length} failure line(s), exit ${input.exitCode}`,
      important: lifecycle && important.length < 25 ? [{ message: lifecycle.trim() }, ...important].slice(0, 25) : important,
      confidence: parserConfidence(
        npmErrors.length > 0 || lifecycle ? 0.82 : important.length > 0 ? 0.68 : 0.56,
        npmErrors.length > 0 || lifecycle ? "npm lifecycle/error markers parsed" : "exit code known with generic failure focus",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const dockerLogsParser: OutputParser = {
  name: "docker-logs",
  aliases: ["docker"],
  parse(input) {
    const lines = linesOf(input);
    const errorLines = lines.filter((line) => /\b(error|fatal|exception|panic|traceback)\b/i.test(line));
    const warningLines = lines.filter((line) => /\bwarn(?:ing)?\b/i.test(line));
    const important = input.exitCode === 0
      ? errorLines.slice(-25).map((line) => itemFromLocation(line.trim()))
      : failureLines(input);
    return {
      parser: "docker-logs",
      status: statusFromExit(input.exitCode),
      summary: `lines=${lines.length} errors=${errorLines.length} warnings=${warningLines.length}`,
      important,
      confidence: parserConfidence(
        lines.length > 0 ? 0.78 : 0.52,
        "docker log severity counters parsed",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const ghParser: OutputParser = {
  name: "gh",
  aliases: ["github-cli"],
  parse(input) {
    const payload = parseJsonPayload(input);
    const important: ParsedImportantItem[] = [];
    let summary = `exit ${input.exitCode}`;
    if (Array.isArray(payload)) {
      const counts: Record<string, number> = {};
      for (const item of payload as Array<Record<string, unknown>>) {
        const key = String(item.conclusion ?? item.status ?? item.state ?? "item").toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
        if (important.length < 25) {
          const title = String(item.title ?? item.name ?? item.workflowName ?? item.url ?? key);
          important.push({ message: title });
        }
      }
      const parts = Object.entries(counts).map(([key, count]) => `${count} ${key}`);
      summary = `${payload.length} item(s)${parts.length ? `: ${parts.join(", ")}` : ""}`;
    } else {
      const lines = linesOf(input);
      const failures = failureLines(input);
      summary = `lines=${lines.length}, exit ${input.exitCode}`;
      important.push(...(input.exitCode === 0 ? lines.slice(0, 10).map((message) => ({ message: message.trim() })) : failures));
    }
    return {
      parser: "gh",
      status: statusFromExit(input.exitCode),
      summary,
      important,
      confidence: parserConfidence(
        Array.isArray(payload) ? 0.86 : important.length > 0 ? 0.68 : 0.55,
        Array.isArray(payload) ? "GitHub CLI JSON output parsed" : "GitHub CLI text output summarized",
      ),
    };
  },
};

const genericFailureParser: OutputParser = {
  name: "generic-failure",
  aliases: ["failure-focus", "generic-test", "node-test-generic", "test-output"],
  parse(input) {
    const important = input.exitCode === 0 ? [] : failureLines(input);
    return {
      parser: "generic-failure",
      status: statusFromExit(input.exitCode),
      summary: important.length > 0
        ? `${important.length} failure line(s), exit ${input.exitCode}`
        : `exit ${input.exitCode}`,
      important,
      confidence: parserConfidence(
        important.length > 0 ? 0.78 : 0.62,
        important.length > 0
          ? "failure keywords and file locations extracted"
          : "exit code known but no failure-focused lines matched",
      ),
      omitted: {
        totalLines: linesOf(input).length,
      },
    };
  },
};

const gitStatusParser: OutputParser = {
  name: "git-status",
  parse(input) {
    const parsedInput = unwrapStructuredOutput(input);
    const lines = linesOf(parsedInput);
    const branch = lines.find((line) => /^On branch /.test(line))?.replace(/^On branch /, "");
    const longChanged = lines.filter((line) => /^\s*(modified|deleted|renamed|new file|both modified):/.test(line)).length;
    const shortStatus = lines.filter((line) => /^[ MADRCU?!]{2}\s+\S/.test(line));
    const shortChanged = shortStatus.filter((line) => !line.startsWith("??") && !line.startsWith("!!")).length;
    const changed = longChanged + shortChanged;
    const untrackedIndex = lines.findIndex((line) => /^Untracked files:/.test(line));
    const hasShortUntracked = shortStatus.some((line) => line.startsWith("??"));
    const clean = lines.some((line) => /working tree clean/i.test(line));
    const important = lines
      .filter((line) => /^(On branch|Your branch|Changes|Untracked|nothing to commit)/.test(line.trim()) || /^[ MADRCU?!]{2}\s+\S/.test(line))
      .slice(0, 20)
      .map((message) => ({ message: message.trim() }));
    return {
      parser: "git-status",
      status: statusFromExit(parsedInput.exitCode),
      summary: clean
        ? `clean${branch ? ` on ${branch}` : ""}`
        : `changed=${changed} untracked=${untrackedIndex >= 0 || hasShortUntracked}${branch ? ` branch=${branch}` : ""}`,
      important,
      confidence: parserConfidence(
        clean || branch || changed > 0 || untrackedIndex >= 0 || hasShortUntracked ? 0.93 : 0.72,
        "git status summary markers parsed",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const gitDiffParser: OutputParser = {
  name: "git-diff",
  parse(input) {
    const lines = linesOf(input);
    const files = new Set<string>();
    let statFileCount: number | undefined;
    let statAdditions: number | undefined;
    let statDeletions: number | undefined;
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      const statSummary = line.match(/^\s*(\d+)\s+files?\s+changed\b(.*)$/);
      if (statSummary) {
        statFileCount = Number(statSummary[1]);
        statAdditions = Number(statSummary[2].match(/(\d+)\s+insertions?\(\+\)/)?.[1] ?? 0);
        statDeletions = Number(statSummary[2].match(/(\d+)\s+deletions?\(-\)/)?.[1] ?? 0);
        continue;
      }
      const statFile = line.match(/^\s*(?![-+])(.+?)\s+\|\s+(?:\d+\s+)?(?:[-+]+|Bin\b.*|0)$/)?.[1]?.trim();
      if (statFile) files.add(statFile);
      const file = line.match(/^\+\+\+ b\/(.+)$/)?.[1] ?? line.match(/^--- a\/(.+)$/)?.[1];
      if (file && file !== "/dev/null") files.add(file);
      if (/^\+[^+]/.test(line)) additions++;
      if (/^-[^-]/.test(line)) deletions++;
    }
    const fileCount = statFileCount ?? files.size;
    const totalAdditions = statAdditions ?? additions;
    const totalDeletions = statDeletions ?? deletions;
    const important = Array.from(files).slice(0, 25).map((file) => ({ file, message: `changed ${file}` }));
    return {
      parser: "git-diff",
      status: statusFromExit(input.exitCode),
      summary: `${fileCount} file(s), +${totalAdditions}/-${totalDeletions}`,
      important,
      confidence: parserConfidence(
        fileCount > 0 || totalAdditions > 0 || totalDeletions > 0 ? 0.9 : 0.68,
        statFileCount !== undefined ? "git diff stat summary parsed" : "unified diff file and line markers parsed",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const rgParser: OutputParser = {
  name: "rg",
  aliases: ["grep", "grouped-search", "search-grouped"],
  parse(input) {
    const lines = linesOf(input);
    const byFile = new Map<string, number>();
    for (const line of lines) {
      const match = line.match(/^([^:\n]+):(\d+):/);
      if (!match) continue;
      byFile.set(match[1], (byFile.get(match[1]) ?? 0) + 1);
    }
    const important = Array.from(byFile.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([file, count]) => ({ file, message: `${count} match(es)` }));
    return {
      parser: "rg",
      status: input.exitCode === 0 || input.exitCode === 1 ? "succeeded" : "failed",
      summary: `${lines.length} match line(s) across ${byFile.size} file(s)`,
      important,
      confidence: parserConfidence(
        byFile.size > 0 || input.exitCode === 1 ? 0.88 : 0.55,
        byFile.size > 0
          ? "ripgrep file:line match format parsed"
          : "ripgrep no-match exit observed without grouped matches",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const gitLogParser: OutputParser = {
  name: "git-log",
  aliases: ["git-history"],
  parse(input) {
    const lines = linesOf(input);
    const commits = lines.filter((line) => /^(commit\s+)?[0-9a-f]{7,40}\b/i.test(line) || /^[0-9a-f]{7,40}\s+/.test(line));
    const authors = new Set<string>();
    for (const line of lines) {
      const author = line.match(/^Author:\s+(.+)$/i)?.[1] ?? line.match(/\bby\s+([^<]+?)(?:\s+<|$)/i)?.[1];
      if (author) authors.add(author.trim());
    }
    const important = lines
      .filter((line) => /^(commit\s+)?[0-9a-f]{7,40}\b/i.test(line) || /^\s{4}\S/.test(line) || /^[0-9a-f]{7,40}\s+/.test(line))
      .slice(0, 20)
      .map((message) => ({ message: message.trim() }));
    return {
      parser: "git-log",
      status: statusFromExit(input.exitCode),
      summary: `commits=${commits.length || lines.filter((line) => line.trim()).length} authors=${authors.size}`,
      important,
      confidence: parserConfidence(
        commits.length > 0 || important.length > 0 ? 0.84 : 0.56,
        "git log commit/message lines summarized",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const fileListParser: OutputParser = {
  name: "file-list",
  aliases: ["ls", "find", "tree", "directory-list"],
  parse(input) {
    const lines = linesOf(input);
    const fileLike = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || /^total\s+\d+/i.test(trimmed)) return false;
      return /[\\/.]/.test(trimmed) || /^[dl-][rwx-]{9}\b/.test(trimmed) || /^[├└│]/.test(trimmed);
    });
    const extCounts = new Map<string, number>();
    let dirs = 0;
    for (const line of fileLike) {
      const trimmed = line.trim();
      if (trimmed.endsWith("/") || /^d[rwx-]{9}\b/.test(trimmed) || /(?:^|[\\/])[^\\/]+[\\/]$/.test(trimmed)) dirs++;
      const ext = trimmed.match(/\.([A-Za-z0-9]{1,12})(?:\s|$)/)?.[1]?.toLowerCase();
      if (ext) extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
    const topExts = Array.from(extCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([ext, count]) => `${ext}=${count}`)
      .join(" ");
    const important = fileLike.slice(0, 20).map((message) => ({ message: message.trim() }));
    return {
      parser: "file-list",
      status: statusFromExit(input.exitCode),
      summary: `entries=${fileLike.length || lines.length} dirs=${dirs}${topExts ? ` ${topExts}` : ""}`,
      important,
      confidence: parserConfidence(
        fileLike.length > 0 ? 0.76 : 0.52,
        "file listing entries counted and sampled",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const cargoParser: OutputParser = {
  name: "cargo",
  aliases: ["rust", "rustc"],
  parse(input) {
    const lines = linesOf(input);
    const errorLines = lines.filter((line) => /^\s*error(?:\[[^\]]+\])?:/i.test(line) || /\berror:/i.test(line));
    const warningLines = lines.filter((line) => /^\s*warning(?:\[[^\]]+\])?:/i.test(line) || /\bwarning:/i.test(line));
    const testSummary = lines.find((line) => /\btest result:\s+/i.test(line));
    const important = (errorLines.length > 0 ? errorLines : warningLines.length > 0 ? warningLines : failureLines(input).map((item) => item.message))
      .slice(0, 25)
      .map((message) => itemFromLocation(message.trim()));
    return {
      parser: "cargo",
      status: statusFromExit(input.exitCode),
      summary: testSummary?.trim() ?? `errors=${errorLines.length} warnings=${warningLines.length} exit=${input.exitCode}`,
      important,
      confidence: parserConfidence(
        errorLines.length > 0 || warningLines.length > 0 || testSummary ? 0.82 : 0.58,
        "Cargo/Rust diagnostic and test-result lines summarized",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

const pipParser: OutputParser = {
  name: "pip",
  aliases: ["pip-install", "python-package"],
  parse(input) {
    const lines = linesOf(input);
    const installs = lines.filter((line) => /\b(Collecting|Installing collected packages|Successfully installed|Requirement already satisfied)\b/i.test(line));
    const failures = failureLines(input);
    return {
      parser: "pip",
      status: statusFromExit(input.exitCode),
      summary: failures.length > 0
        ? `${failures.length} failure line(s), exit ${input.exitCode}`
        : `package lines=${installs.length} exit=${input.exitCode}`,
      important: failures.length > 0 ? failures : installs.slice(-20).map((message) => ({ message: message.trim() })),
      confidence: parserConfidence(
        installs.length > 0 || failures.length > 0 ? 0.76 : 0.54,
        "pip package/install markers summarized",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

function countObjectKeys(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).length
    : 0;
}

const packageJsonParser: OutputParser = {
  name: "package-json",
  aliases: ["package"],
  parse(input) {
    const payload = parseJsonPayload(input);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        parser: "package-json",
        status: statusFromExit(input.exitCode),
        summary: `package.json not parsed, exit ${input.exitCode}`,
        important: failureLines(input),
        confidence: parserConfidence(0.3, "package.json JSON payload not found"),
      };
    }
    const object = payload as Record<string, unknown>;
    const name = typeof object.name === "string" ? object.name : undefined;
    const version = typeof object.version === "string" ? object.version : undefined;
    const scripts = countObjectKeys(object.scripts);
    const deps = countObjectKeys(object.dependencies);
    const devDeps = countObjectKeys(object.devDependencies);
    const important: ParsedImportantItem[] = [];
    if (name) important.push({ message: `"name": ${JSON.stringify(name)}` });
    if (version) important.push({ message: `"version": ${JSON.stringify(version)}` });
    if (scripts > 0) important.push({ message: `scripts=${scripts}` });
    if (deps > 0 || devDeps > 0) important.push({ message: `dependencies=${deps} devDependencies=${devDeps}` });
    return {
      parser: "package-json",
      status: statusFromExit(input.exitCode),
      summary: `name=${name ?? "unknown"} version=${version ?? "unknown"} scripts=${scripts} deps=${deps} devDeps=${devDeps}`,
      important,
      confidence: parserConfidence(name || scripts > 0 ? 0.9 : 0.6, "package.json metadata summarized"),
      omitted: { totalLines: linesOf(input).length },
    };
  },
};

const ciLogParser: OutputParser = {
  name: "ci-log",
  aliases: ["gha", "github-actions", "webpack", "vite", "build-log"],
  parse(input) {
    const lines = linesOf(input);
    const errors = lines.filter((line) => /\b(error|failed|failure|fatal|exception|panic)\b/i.test(line));
    const warnings = lines.filter((line) => /\bwarn(?:ing)?\b/i.test(line));
    const sections = lines.filter((line) => /^##\[[a-z]+\]/i.test(line) || /^(Run|Error:|FAIL|FAILED|x)\b/i.test(line.trim()));
    const important = (errors.length > 0 ? errors : sections.length > 0 ? sections : warnings)
      .slice(0, 25)
      .map((message) => itemFromLocation(message.trim()));
    return {
      parser: "ci-log",
      status: statusFromExit(input.exitCode),
      summary: `lines=${lines.length} errors=${errors.length} warnings=${warnings.length} sections=${sections.length} exit=${input.exitCode}`,
      important,
      confidence: parserConfidence(
        errors.length > 0 || warnings.length > 0 || sections.length > 0 ? 0.8 : 0.55,
        "CI/build log severity and section markers summarized",
      ),
      omitted: { totalLines: lines.length },
    };
  },
};

export const OUTPUT_PARSERS: readonly OutputParser[] = [
  vitestJsonParser,
  vitestParser,
  playwrightJsonParser,
  playwrightParser,
  pytestParser,
  tscParser,
  eslintParser,
  npmParser,
  dockerLogsParser,
  ghParser,
  genericFailureParser,
  gitStatusParser,
  gitDiffParser,
  gitLogParser,
  rgParser,
  fileListParser,
  cargoParser,
  pipParser,
  packageJsonParser,
  ciLogParser,
];

export function getOutputParser(name: string): OutputParser | undefined {
  return OUTPUT_PARSERS.find((parser) => parser.name === name || parser.aliases?.includes(name));
}

export function parseCommandOutput(parserName: string, input: ParserInput): ParsedOutput {
  const parser = getOutputParser(parserName);
  if (!parser) {
    return {
      parser: parserName,
      status: "unknown",
      summary: `parser not found: ${parserName}`,
      important: [],
      confidence: parserConfidence(0, "parser registry lookup failed"),
      diagnostics: [`parser not found: ${parserName}`],
    };
  }
  try {
    return parser.parse(input);
  } catch (err) {
    return {
      parser: parser.name,
      status: "unknown",
      summary: `parser failed: ${err instanceof Error ? err.message : String(err)}`,
      important: [],
      confidence: parserConfidence(0, "parser threw before producing a trusted summary"),
      diagnostics: [`parser failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

export function renderParsedOutput(parsed: ParsedOutput, options: RenderParsedOutputOptions = {}): string {
  const maxImportantItems = options.maxImportantItems === undefined
    ? parsed.important.length
    : Math.max(0, Math.floor(options.maxImportantItems));
  const important = parsed.important.slice(0, maxImportantItems);
  const importantItemsOmitted = Math.max(0, parsed.important.length - important.length);
  const omitted = {
    ...(parsed.omitted ?? {}),
    ...(importantItemsOmitted > 0 ? { importantItems: importantItemsOmitted } : {}),
  };
  const lines = [
    `${parsed.status.toUpperCase()} ${parsed.summary}`,
    `parser: ${parsed.parser} (${parsed.confidence.level} confidence ${Math.round(parsed.confidence.score * 100)}% - ${parsed.confidence.reason})`,
  ];
  if (important.length > 0) {
    lines.push("", "Important:");
    for (const item of important) {
      const loc = item.file ? `${item.file}${item.line ? `:${item.line}` : ""} ` : "";
      lines.push(`- ${loc}${item.message}`);
    }
  }
  if (Object.keys(omitted).length > 0) {
    lines.push("", `Omitted: ${JSON.stringify(omitted)}`);
  }
  if (parsed.diagnostics && parsed.diagnostics.length > 0) {
    lines.push("", `Diagnostics: ${parsed.diagnostics.join("; ")}`);
  }
  return lines.join("\n");
}
