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

export interface ClassifyCommandOptions {
  dialect?: ShellDialect;
  runId?: string;
  stdinBytes?: number;
  stdinShape?: string;
}

export function stableCommandHash(command: string): string {
  return createHash("sha256").update(command).digest("hex");
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
  if (/[;&|$`]|^\s*(export|cd|source)\b/.test(command)) return "posix";
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
    if (ch === "\\" && quote !== "'") {
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
    if (ch === "\\" && quote !== "'") {
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
  })).map((seg) => ({
    ...seg,
    classificationOnly:
      seg.hasSideEffects
      || seg.operatorsBefore.includes("|")
      || seg.operatorsAfter.includes("|")
      || /[<>]|\$\(|`|<<\s*\w+/.test(seg.rawShape),
  }));
}

function hasLikelySideEffects(command: string): boolean {
  const [first, second] = shellSplit(command);
  if (!first) return false;
  const token = first.toLowerCase();
  if (["rm", "mv", "cp", "mkdir", "rmdir", "touch", "chmod", "chown", "git"].includes(token)) {
    if (token !== "git") return true;
    return !["status", "diff", "show", "log"].includes((second ?? "").toLowerCase());
  }
  return false;
}

function classifyInput(command: string, opts: ClassifyCommandOptions): CommandInput {
  const heredocDetected = /<<[-~]?\s*['"]?[\w.-]+['"]?/.test(command);
  const stdinPresent = heredocDetected || /(^|[^|])\|([^|]|$)|<\s*\S/.test(command) || (opts.stdinBytes ?? 0) > 0;
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
  const input = classifyInput(normalized, opts);
  const interactivity = classifyInteractivity(normalized, argv, input);
  const segments = splitSegments(normalized, dialect, runId);
  const hasCompoundOperators = segments.length > 1;
  const hasRedirection = /(^|[^<])>\s*\S|<\s*\S/.test(normalized);
  const hasSubshell = /\$\(|`/.test(normalized);
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
