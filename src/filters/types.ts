export interface FilterInput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  commandShape?: string;
  parserName?: string;
}

export interface FilterOutput {
  stdout: string;
  stderr: string;
  summary?: string;
  important: Array<{
    file?: string;
    line?: number;
    message: string;
  }>;
  omitted: Record<string, unknown>;
  redactionCounts: Record<string, number>;
  diagnostics: string[];
}

export interface FilterStep {
  name: string;
  version: string;
  run(input: FilterOutput): FilterOutput;
}

export interface FilterPipelineResult extends FilterOutput {
  parseFailure: boolean;
  failedStep?: string;
}
