import type { OutputParser, ParsedImportantItem, ParsedOutput, ParserConfidence, ParserInput } from "./types.js";

export interface RenderParsedOutputOptions {
  readonly maxImportantItems?: number;
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
  return `${input.stdout}\n${input.stderr}`.split(/\r?\n/).filter((line) => line.trim().length > 0);
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
    return { ...input, stdout, stderr, exitCode };
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

const genericFailureParser: OutputParser = {
  name: "generic-failure",
  aliases: ["failure-focus", "generic-test", "node-test-generic", "pytest", "test-output"],
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

export const OUTPUT_PARSERS: readonly OutputParser[] = [
  vitestJsonParser,
  vitestParser,
  playwrightJsonParser,
  playwrightParser,
  genericFailureParser,
  gitStatusParser,
  gitDiffParser,
  rgParser,
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
