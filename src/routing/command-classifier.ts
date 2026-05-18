import { createHash, randomUUID } from "node:crypto";
import type {
  ClassifiedCommand,
  CommandInput,
  CommandSegment,
  InteractivitySignals,
  ShellDialect,
} from "./types.js";

const SECRET_NAME_RE = /(token|secret|password|passwd|pwd|api[_-]?key|auth|cookie|credential)/i;
const INTERACTIVE_COMMANDS = new Set([
  "vim",
  "vi",
  "nvim",
  "nano",
  "emacs",
  "less",
  "more",
  "ssh",
  "sudo",
  "watch",
]);

const LONG_RUNNING_PATTERNS = [
  /\bnpm\s+run\s+dev\b/i,
  /\bpnpm\s+dev\b/i,
  /\byarn\s+dev\b/i,
  /\b(vite|next|webpack|turbo)\b.*\b(--watch|dev|serve)\b/i,
  /\btail\s+-f\b/i,
  /\bwatch\b/i,
];

const WATCH_MODE_PATTERNS = [
  /\b--watch(All)?\b/i,
  /\b-watch\b/i,
  /\bpytest\b.*\b(-f|--looponfail)\b/i,
  /\bvitest\b(?!.*\brun\b)/i,
  /\bjest\b.*\b--watch\b/i,
];
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--attr-source",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
]);
const GIT_GLOBAL_OPTIONS = new Set([
  "--bare",
  "--build-options",
  "--glob-pathspecs",
  "--help",
  "--html-path",
  "--icase-pathspecs",
  "--info-path",
  "--literal-pathspecs",
  "--man-path",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-pager",
  "--no-replace-objects",
  "--noglob-pathspecs",
  "--paginate",
  "--version",
]);
const GIT_READONLY_SUBCOMMANDS = new Set(["status", "diff", "show", "log"]);

export interface ClassifyCommandOptions {
  dialect?: ShellDialect;
  runId?: string;
  stdinBytes?: number;
  stdinShape?: string;
}

export function stableCommandHash(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

function isLeadingEnvAssignment(raw: string | undefined): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw ?? "");
}

function executableToken(token: string | undefined): string {
  const base = (token ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase() ?? "";
  return base.replace(/\.(?:cmd|exe|bat|ps1)$/i, "");
}

export function gitSubcommandIndex(argv: readonly string[]): number {
  let i = 0;
  while (i < argv.length && isLeadingEnvAssignment(argv[i])) i++;
  if (executableToken(argv[i]) !== "git") return -1;
  i++;

  while (i < argv.length) {
    const raw = argv[i] ?? "";
    if (raw === "--") return i + 1 < argv.length ? i + 1 : -1;
    if (!raw.startsWith("-")) return i;

    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(raw)) {
      i += 2;
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq > 0 && GIT_GLOBAL_OPTIONS_WITH_VALUE.has(raw.slice(0, eq))) {
      i++;
      continue;
    }
    if ((raw.startsWith("-C") || raw.startsWith("-c")) && raw.length > 2) {
      i++;
      continue;
    }
    if (GIT_GLOBAL_OPTIONS.has(raw)) {
      i++;
      continue;
    }
    i++;
  }

  return -1;
}

export function gitSubcommand(argv: readonly string[]): string {
  const index = gitSubcommandIndex(argv);
  return index >= 0 ? (argv[index] ?? "").toLowerCase() : "";
}

interface ShellMeta {
  readonly hasControlOperator: boolean;
  readonly hasPipeline: boolean;
  readonly hasInputRedirection: boolean;
  readonly hasOutputRedirection: boolean;
  readonly hasHeredoc: boolean;
  readonly hasSubshell: boolean;
  readonly hasBacktick: boolean;
}

function isShellEscape(ch: string, quote: "'" | "\"" | null, dialect: ShellDialect): boolean {
  if (dialect === "powershell") return ch === "`" && quote !== "'";
  if (dialect === "cmd") return ch === "^";
  return ch === "\\" && quote !== "'";
}

function isWindowsDrivePathToken(value: string): boolean {
  return /^[A-Za-z]:(?:\\|$)/.test(value);
}

function scanShellMeta(command: string, dialect: ShellDialect = "unknown"): ShellMeta {
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  let hasControlOperator = false;
  let hasPipeline = false;
  let hasInputRedirection = false;
  let hasOutputRedirection = false;
  let hasHeredoc = false;
  let hasSubshell = false;
  let hasBacktick = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1] ?? "";
    const prev = command[i - 1] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (isShellEscape(ch, quote, dialect)) {
      escaped = true;
      continue;
    }
    if ((ch === "'" || ch === "\"") && quote === null) {
      quote = ch;
      continue;
    }
    if (quote === ch) {
      quote = null;
      continue;
    }
    if (quote !== "'") {
      if (ch === "$" && next === "(") {
        hasSubshell = true;
        continue;
      }
      if (ch === "`") {
        hasBacktick = true;
        continue;
      }
    }
    if (quote !== null) continue;

    if (ch === "\r" || ch === "\n") {
      hasControlOperator = true;
      if (ch === "\r" && next === "\n") i++;
      continue;
    }
    if (ch === "&" && next === ">") {
      hasOutputRedirection = true;
      i++;
      continue;
    }
    if (ch === "&" && next === "&") {
      hasControlOperator = true;
      i++;
      continue;
    }
    if (ch === "|" && next === "|") {
      hasControlOperator = true;
      i++;
      continue;
    }
    if (ch === "|") {
      hasControlOperator = true;
      if (prev !== "|") hasPipeline = true;
      continue;
    }
    if (ch === ";") {
      hasControlOperator = true;
      continue;
    }
    if (ch === "&" && prev !== ">") {
      hasControlOperator = true;
      continue;
    }
    if (ch === "<") {
      hasInputRedirection = true;
      if (next === "<") {
        hasHeredoc = true;
        i++;
      }
      continue;
    }
    if (ch === ">") {
      hasOutputRedirection = true;
      continue;
    }
  }

  return {
    hasControlOperator,
    hasPipeline,
    hasInputRedirection,
    hasOutputRedirection,
    hasHeredoc,
    hasSubshell,
    hasBacktick,
  };
}

export function redactCommandShape(command: string): string {
  let redacted = command.replace(
    /([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API[_-]?KEY|AUTH|COOKIE|CREDENTIAL)[A-Z0-9_]*=)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
    "$1<redacted>",
  );
  redacted = redacted.replace(
    /(https?:\/\/)([^:\s/@]+):([^@\s]+)@/gi,
    "$1<user>:<redacted>@",
  );
  redacted = redacted.replace(
    /(--(?:token|password|secret|api-key|auth|cookie)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
    "$1<redacted>",
  );
  return redacted;
}

export function detectShellDialect(command: string): ShellDialect {
  if (/\b(Get-Content|Select-String|Where-Object|ForEach-Object|Write-Host)\b/.test(command)) {
    return "powershell";
  }
  if (/\b(cmd\.exe|dir\s+\/|findstr\b|type\s+)/i.test(command)) {
    return "cmd";
  }
  const meta = scanShellMeta(command);
  if (
    meta.hasControlOperator
    || meta.hasInputRedirection
    || meta.hasOutputRedirection
    || meta.hasSubshell
    || meta.hasBacktick
    || /^\s*(export|cd|source)\b/.test(command)
  ) return "posix";
  return "unknown";
}

export function shellSplit(command: string): string[] {
  const args: string[] = [];
  let cur = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  for (const ch of command.trim()) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'" && !isWindowsDrivePathToken(cur)) {
      escaped = true;
      continue;
    }
    if ((ch === "'" || ch === "\"") && quote === null) {
      quote = ch;
      continue;
    }
    if (quote === ch) {
      quote = null;
      continue;
    }
    if (/\s/.test(ch) && quote === null) {
      if (cur) args.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

function splitSegments(command: string, dialect: ShellDialect, runId: string): CommandSegment[] {
  const segments: Array<{ text: string; before: string[]; after: string[] }> = [];
  let cur = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  let before: string[] = [];
  const push = (operator: string) => {
    const text = cur.trim();
    if (text) segments.push({ text, before, after: [operator] });
    before = [operator];
    cur = "";
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1] ?? "";
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (isShellEscape(ch, quote, dialect)) {
      cur += ch;
      escaped = true;
      continue;
    }
    if ((ch === "'" || ch === "\"") && quote === null) {
      quote = ch;
      cur += ch;
      continue;
    }
    if (quote === ch) {
      quote = null;
      cur += ch;
      continue;
    }
    if (quote === null) {
      if (ch === "&" && next === "&") {
        push("&&");
        i++;
        continue;
      }
      if (ch === "|" && next === "|") {
        push("||");
        i++;
        continue;
      }
      if (ch === "|" || ch === ";") {
        push(ch);
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        push("\\n");
        if (ch === "\r" && next === "\n") i++;
        continue;
      }
      if (ch === "&" && next === ">") {
        cur += ch;
        continue;
      }
      if (ch === "&" && next !== "&" && command[i - 1] !== ">") {
        push("&");
        continue;
      }
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) segments.push({ text: tail, before, after: [] });

  return segments.map((seg, index) => ({
    id: `${runId}:${index}`,
    parentRunId: runId,
    index,
    dialect,
    rawShape: seg.text,
    redactedShape: redactCommandShape(seg.text),
    operatorsBefore: seg.before,
    operatorsAfter: seg.after,
    hasSideEffects: hasLikelySideEffects(seg.text),
    classificationOnly: false,
  })).map((seg) => {
    const meta = scanShellMeta(seg.rawShape, dialect);
    return {
      ...seg,
      classificationOnly:
        seg.hasSideEffects
        || seg.operatorsBefore.includes("|")
        || seg.operatorsAfter.includes("|")
        || meta.hasInputRedirection
        || meta.hasOutputRedirection
        || meta.hasSubshell
        || meta.hasBacktick,
    };
  });
}

function hasLikelySideEffects(command: string): boolean {
  const argv = shellSplit(command);
  const [first] = argv;
  if (!first) return false;
  const token = executableToken(first);
  if (["rm", "mv", "cp", "mkdir", "rmdir", "touch", "chmod", "chown", "git"].includes(token)) {
    if (token !== "git") return true;
    return !GIT_READONLY_SUBCOMMANDS.has(gitSubcommand(argv));
  }
  return false;
}

function classifyInput(command: string, opts: ClassifyCommandOptions, dialect: ShellDialect): CommandInput {
  const meta = scanShellMeta(command, dialect);
  const heredocDetected = meta.hasHeredoc;
  const stdinPresent = heredocDetected || meta.hasPipeline || meta.hasInputRedirection || (opts.stdinBytes ?? 0) > 0;
  return {
    stdinPresent,
    stdinBytes: opts.stdinBytes ?? 0,
    stdinHash: opts.stdinBytes ? stableCommandHash(opts.stdinShape ?? String(opts.stdinBytes)) : undefined,
    stdinRedactedShape: opts.stdinShape ? redactCommandShape(opts.stdinShape) : undefined,
    heredocDetected,
    stdinPersisted: false,
  };
}

function classifyInteractivity(command: string, argv: string[], input: CommandInput): InteractivitySignals {
  const first = (argv[0] ?? "").toLowerCase();
  const joined = command.toLowerCase();
  const explicitInteractive =
    INTERACTIVE_COMMANDS.has(first)
    || /\bgit\s+rebase\s+-i\b/i.test(command)
    || /\b(npm|pnpm|yarn)\s+(init|create)\b/i.test(command)
    || /\bsudo\b/.test(joined);
  const isLongRunning = LONG_RUNNING_PATTERNS.some((re) => re.test(command));
  const isWatchMode = WATCH_MODE_PATTERNS.some((re) => re.test(command));
  const requiresTty = explicitInteractive;
  const possible = input.stdinPresent || isLongRunning || isWatchMode;
  return {
    requiresTty,
    usesStdin: input.stdinPresent,
    isLongRunning,
    isWatchMode,
    interactiveRisk: requiresTty ? "likely" : possible ? "possible" : "none",
  };
}

export function classifyCommand(command: string, opts: ClassifyCommandOptions = {}): ClassifiedCommand {
  const normalized = command.trim();
  const dialect = opts.dialect ?? detectShellDialect(command);
  const runId = opts.runId ?? randomUUID();
  const argv = shellSplit(normalized);
  const input = classifyInput(normalized, opts, dialect);
  const interactivity = classifyInteractivity(normalized, argv, input);
  const segments = splitSegments(normalized, dialect, runId);
  const hasCompoundOperators = segments.length > 1;
  const meta = scanShellMeta(normalized, dialect);
  const hasRedirection = meta.hasInputRedirection || meta.hasOutputRedirection;
  const hasSubshell = meta.hasSubshell || meta.hasBacktick;
  const hasEnvAssignment = argv.some((arg, idx) => idx < 3 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg));

  return {
    raw: command,
    normalized,
    dialect,
    runId,
    firstToken: (argv[0] ?? "").toLowerCase(),
    argv,
    segments,
    interactivity,
    input,
    hasCompoundOperators,
    hasRedirection,
    hasSubshell,
    hasEnvAssignment,
    redactedShape: redactCommandShape(normalized),
  };
}

export function commandHasSecretShape(command: string): boolean {
  return shellSplit(command).some((arg) => SECRET_NAME_RE.test(arg));
}
