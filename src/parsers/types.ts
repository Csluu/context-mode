export type ParsedStatus = "succeeded" | "failed" | "unknown";

export interface ParserInput {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ParsedImportantItem {
  readonly file?: string;
  readonly line?: number;
  readonly message: string;
}

export type ParserConfidenceLevel = "high" | "medium" | "low";

export interface ParserConfidence {
  readonly score: number;
  readonly level: ParserConfidenceLevel;
  readonly reason: string;
}

export interface ParsedOutput {
  readonly parser: string;
  readonly status: ParsedStatus;
  readonly summary: string;
  readonly important: readonly ParsedImportantItem[];
  readonly confidence: ParserConfidence;
  readonly omitted?: Record<string, number | string | boolean>;
  readonly diagnostics?: readonly string[];
}

export interface OutputParser {
  readonly name: string;
  readonly aliases?: readonly string[];
  parse(input: ParserInput): ParsedOutput;
}
