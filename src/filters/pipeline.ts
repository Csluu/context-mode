import type { FilterInput, FilterOutput, FilterPipelineResult, FilterStep } from "./types.js";

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const REDACTIONS: Array<[string, RegExp]> = [
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ["openai_token", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ["private_key_block", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g],
  ["cookie_header", /\b((?:Set-)?Cookie:\s*)[^\r\n]+/gi],
  ["api_key_header", /\b((?:x-api-key|api-key):\s*)[^\r\n]+/gi],
  ["generic_secret_assignment", /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTH|COOKIE)[A-Z0-9_]*=)(?:"[^"]*"|'[^']*'|[^\s]+)/gi],
  ["common_cookie_assignment", /\b((?:sessionid|session_id|sid|connect\.sid)=)[^\s;]+/gi],
  ["authorization_header", /\b(Authorization:\s*)(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi],
  ["credentialed_url", /(https?:\/\/)([^:\s/@]+):([^@\s]+)@/gi],
];

function baseOutput(input: FilterInput): FilterOutput {
  return {
    stdout: input.stdout,
    stderr: input.stderr,
    important: [],
    omitted: {},
    redactionCounts: {},
    diagnostics: [],
  };
}

function countMatches(text: string, re: RegExp): number {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function redactOne(text: string, counts: Record<string, number>): string {
  let out = text;
  for (const [name, re] of REDACTIONS) {
    const n = countMatches(out, re);
    if (n > 0) counts[name] = (counts[name] ?? 0) + n;
    if (name === "generic_secret_assignment") {
      out = out.replace(re, (match: string, prefix: string) => {
        const value = match.slice(prefix.length);
        const quote = value.startsWith("\"") ? "\"" : value.startsWith("'") ? "'" : "";
        return quote ? `${prefix}${quote}<redacted>${quote}` : `${prefix}<redacted>`;
      });
    } else if (name === "authorization_header") {
      out = out.replace(re, "$1$2 <redacted>");
    } else if (name === "cookie_header" || name === "api_key_header" || name === "common_cookie_assignment") {
      out = out.replace(re, "$1<redacted>");
    } else if (name === "credentialed_url") {
      out = out.replace(re, "$1<user>:<redacted>@");
    } else {
      out = out.replace(re, "<redacted>");
    }
  }
  return out;
}

export function redactText(text: string): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  return { text: redactOne(text, counts), counts };
}

export const stripAnsiControlsFilter: FilterStep = {
  name: "strip-ansi-controls",
  version: "1",
  run(input) {
    const stdoutBefore = input.stdout.length;
    const stderrBefore = input.stderr.length;
    input.stdout = input.stdout.replace(ANSI_RE, "");
    input.stderr = input.stderr.replace(ANSI_RE, "");
    const removed = stdoutBefore + stderrBefore - input.stdout.length - input.stderr.length;
    if (removed > 0) input.omitted.ansiControlBytes = removed;
    return input;
  },
};

export const redactSecretsFilter: FilterStep = {
  name: "redact-secrets",
  version: "1",
  run(input) {
    const out1 = redactText(input.stdout);
    const out2 = redactText(input.stderr);
    input.stdout = out1.text;
    input.stderr = out2.text;
    for (const [k, v] of Object.entries(out1.counts)) input.redactionCounts[k] = (input.redactionCounts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(out2.counts)) input.redactionCounts[k] = (input.redactionCounts[k] ?? 0) + v;
    return input;
  },
};

export const failureFocusFilter: FilterStep = {
  name: "failure-focus",
  version: "1",
  run(input) {
    const lines = `${input.stdout}\n${input.stderr}`.split(/\r?\n/);
    const important = lines
      .map((line) => line.trim())
      .filter((line) => /\b(error|failed|failure|exception|timeout|expected|received)\b/i.test(line))
      .slice(-25)
      .map((message) => ({ message }));
    input.important.push(...important);
    if (important.length > 0) input.summary = `${important.length} important failure line(s)`;
    return input;
  },
};

export function runFilterPipeline(input: FilterInput, steps: readonly FilterStep[]): FilterPipelineResult {
  let current = baseOutput(input);
  for (const step of steps) {
    try {
      current = step.run(current);
    } catch (err) {
      current.diagnostics.push(`${step.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        ...current,
        parseFailure: true,
        failedStep: step.name,
      };
    }
  }
  return {
    ...current,
    parseFailure: false,
  };
}

export const DEFAULT_FILTER_PIPELINE: readonly FilterStep[] = [
  stripAnsiControlsFilter,
  redactSecretsFilter,
  failureFocusFilter,
];
