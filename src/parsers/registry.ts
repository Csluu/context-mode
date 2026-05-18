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

const genericFailureParser: OutputParser = {
  name: "generic-failure",
  aliases: ["failure-focus", "generic-test", "node-test-generic", "vitest", "vitest-json", "pytest", "test-output"],
  parse(input) {
    const important = failureLines(input);
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
    const lines = linesOf(input);
    const branch = lines.find((line) => /^On branch /.test(line))?.replace(/^On branch /, "");
    const changed = lines.filter((line) => /^\s*(modified|deleted|renamed|new file|both modified):/.test(line)).length;
    const untrackedIndex = lines.findIndex((line) => /^Untracked files:/.test(line));
    const clean = lines.some((line) => /working tree clean/i.test(line));
    const important = lines
      .filter((line) => /^(On branch|Your branch|Changes|Untracked|nothing to commit)/.test(line.trim()))
      .slice(0, 20)
      .map((message) => ({ message: message.trim() }));
    return {
      parser: "git-status",
      status: statusFromExit(input.exitCode),
      summary: clean
        ? `clean${branch ? ` on ${branch}` : ""}`
        : `changed=${changed} untracked=${untrackedIndex >= 0}${branch ? ` branch=${branch}` : ""}`,
      important,
      confidence: parserConfidence(
        clean || branch || changed > 0 || untrackedIndex >= 0 ? 0.93 : 0.72,
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
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      const file = line.match(/^\+\+\+ b\/(.+)$/)?.[1] ?? line.match(/^--- a\/(.+)$/)?.[1];
      if (file && file !== "/dev/null") files.add(file);
      if (/^\+[^+]/.test(line)) additions++;
      if (/^-[^-]/.test(line)) deletions++;
    }
    const important = Array.from(files).slice(0, 25).map((file) => ({ file, message: `changed ${file}` }));
    return {
      parser: "git-diff",
      status: statusFromExit(input.exitCode),
      summary: `${files.size} file(s), +${additions}/-${deletions}`,
      important,
      confidence: parserConfidence(
        files.size > 0 || additions > 0 || deletions > 0 ? 0.9 : 0.68,
        "unified diff file and line markers parsed",
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
