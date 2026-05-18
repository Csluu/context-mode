export type GuardSurface =
  | "chat"
  | "sidecar"
  | "index"
  | "trace"
  | "cache"
  | "eval-fixture"
  | "release-artifact";

export type GuardSeverity = "info" | "low" | "medium" | "high" | "critical";
export type GuardAction = "allow" | "redact" | "block-persistence" | "block-return" | "needs-review";
export type GuardConfidence = "low" | "medium" | "high";

export interface GuardFinding {
  readonly ruleId: string;
  readonly severity: GuardSeverity;
  readonly action: GuardAction;
  readonly surface: GuardSurface;
  readonly confidence: GuardConfidence;
  readonly byteStart?: number;
  readonly byteEnd?: number;
  readonly redactionLabel?: string;
  readonly message: string;
}

export interface GuardDecision {
  readonly schemaVersion: 1;
  readonly guardVersion: string;
  readonly surface: GuardSurface;
  readonly status: "allow" | "redacted" | "blocked" | "needs-review" | "unavailable";
  readonly findings: readonly GuardFinding[];
  readonly redactedText?: string;
  readonly counts: Record<string, number>;
  readonly warnings?: readonly string[];
}

export interface GuardScanReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly guardVersion: string;
  readonly subjects: Array<{ surface: GuardSurface; pathOrId: string; status: string; findings: number }>;
  readonly totals: Record<GuardSeverity, number>;
  readonly failed: boolean;
}

interface GuardRule {
  readonly id: string;
  readonly severity: GuardSeverity;
  readonly confidence: GuardConfidence;
  readonly label?: string;
  readonly message: string;
  readonly pattern: RegExp;
}

export const GUARD_VERSION = "1";

const PERSISTENCE_SURFACES = new Set<GuardSurface>([
  "sidecar",
  "index",
  "trace",
  "cache",
  "eval-fixture",
  "release-artifact",
]);

const SECRET_RULES: readonly GuardRule[] = [
  {
    id: "aws_access_key",
    severity: "critical",
    confidence: "high",
    label: "AWS_ACCESS_KEY",
    message: "AWS access key shape detected",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "aws_secret_assignment",
    severity: "critical",
    confidence: "high",
    label: "AWS_SECRET",
    message: "AWS secret key assignment detected",
    pattern: /\b(AWS_SECRET_ACCESS_KEY\s*=\s*)(?:"[^"]+"|'[^']+'|[A-Za-z0-9/+=]{30,})/gi,
  },
  {
    id: "github_token",
    severity: "critical",
    confidence: "high",
    label: "GITHUB_TOKEN",
    message: "GitHub token shape detected",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  {
    id: "openai_token",
    severity: "critical",
    confidence: "high",
    label: "OPENAI_TOKEN",
    message: "OpenAI token shape detected",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "npm_token",
    severity: "critical",
    confidence: "high",
    label: "NPM_TOKEN",
    message: "npm token shape detected",
    pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g,
  },
  {
    id: "pypi_token",
    severity: "critical",
    confidence: "high",
    label: "PYPI_TOKEN",
    message: "PyPI token shape detected",
    pattern: /\bpypi-[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    id: "slack_token",
    severity: "critical",
    confidence: "high",
    label: "SLACK_TOKEN",
    message: "Slack token shape detected",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    id: "stripe_secret_key",
    severity: "critical",
    confidence: "high",
    label: "STRIPE_SECRET",
    message: "Stripe secret key shape detected",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "azure_google_secret_assignment",
    severity: "critical",
    confidence: "medium",
    label: "CLOUD_SECRET",
    message: "Cloud credential assignment detected",
    pattern: /\b((?:AZURE|GOOGLE|GCP)_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)\s*=\s*)(?:"[^"]+"|'[^']+'|[^\s]+)/gi,
  },
  {
    id: "authorization_header",
    severity: "critical",
    confidence: "high",
    label: "AUTHORIZATION",
    message: "Authorization header detected",
    pattern: /\b(Authorization:\s*)(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  },
  {
    id: "cookie_header",
    severity: "high",
    confidence: "high",
    label: "COOKIE",
    message: "Cookie header detected",
    pattern: /\b((?:Set-)?Cookie:\s*)[^\r\n]+/gi,
  },
  {
    id: "api_key_header",
    severity: "critical",
    confidence: "high",
    label: "API_KEY",
    message: "API key header detected",
    pattern: /\b((?:x-api-key|api-key):\s*)[^\r\n]+/gi,
  },
  {
    id: "credentialed_url",
    severity: "critical",
    confidence: "high",
    label: "CRED_URL",
    message: "Credentialed URL detected",
    pattern: /(https?:\/\/)([^:\s/@]+):([^@\s]+)@/gi,
  },
  {
    id: "jwt",
    severity: "high",
    confidence: "medium",
    label: "JWT",
    message: "JWT-like token detected",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: "private_key_block",
    severity: "critical",
    confidence: "high",
    label: "PRIVATE_KEY",
    message: "Private key block detected",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    id: "generic_secret_assignment",
    severity: "high",
    confidence: "medium",
    label: "SECRET_ASSIGNMENT",
    message: "Secret-looking assignment detected",
    pattern: /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API[_-]?KEY|AUTH|COOKIE|CREDENTIAL)[A-Z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
  },
  {
    id: "netrc_password",
    severity: "critical",
    confidence: "high",
    label: "NETRC_PASSWORD",
    message: ".netrc password entry detected",
    pattern: /\b(machine\s+\S+\s+login\s+\S+\s+password\s+)(\S+)/gi,
  },
  {
    id: "kubeconfig_token",
    severity: "critical",
    confidence: "medium",
    label: "KUBECONFIG_TOKEN",
    message: "kubeconfig credential field detected",
    pattern: /\b((?:client-key-data|token):\s*)[A-Za-z0-9+/=_-]{20,}/gi,
  },
  {
    id: "query_string_token",
    severity: "high",
    confidence: "medium",
    label: "QUERY_TOKEN",
    message: "credential query parameter detected",
    pattern: /([?&](?:token|api_key|apikey|access_token|auth|password|secret)=)[^&\s]+/gi,
  },
];

const CONTROL_RULES: readonly GuardRule[] = [
  {
    id: "osc52_clipboard",
    severity: "critical",
    confidence: "high",
    label: "OSC52",
    message: "terminal clipboard control sequence detected",
    pattern: /\x1b\]52;[^\x07]*(?:\x07|\x1b\\)/g,
  },
  {
    id: "terminal_hyperlink",
    severity: "medium",
    confidence: "high",
    label: "OSC8",
    message: "terminal hyperlink control sequence detected",
    pattern: /\x1b\]8;;[^\x07]*(?:\x07|\x1b\\)/g,
  },
  {
    id: "ansi_control",
    severity: "low",
    confidence: "high",
    label: "ANSI",
    message: "ANSI/control sequence detected",
    pattern: /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
  },
  {
    id: "c0_control",
    severity: "medium",
    confidence: "medium",
    label: "CONTROL",
    message: "C0/C1 control character detected",
    pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g,
  },
];

const INSTRUCTION_RULES: readonly GuardRule[] = [
  {
    id: "untrusted_role_injection",
    severity: "medium",
    confidence: "medium",
    label: "PROMPT_INJECTION",
    message: "instruction-looking role marker detected in untrusted content",
    pattern: /<(?:system|developer|tool|assistant|user)(?:\s[^>]*)?>|^\s*(?:system|developer|tool):/gim,
  },
  {
    id: "credential_exfil_instruction",
    severity: "high",
    confidence: "medium",
    label: "EXFIL_INSTRUCTION",
    message: "credential exfiltration instruction detected",
    pattern: /\b(?:ignore (?:all )?(?:previous|prior) instructions|send (?:me|us).{0,60}(?:token|secret|password|cookie|credential)|exfiltrat(?:e|ion))\b/gi,
  },
];

function actionFor(surface: GuardSurface, severity: GuardSeverity, ruleId: string): GuardAction {
  if (ruleId === "c0_control" || ruleId === "osc52_clipboard") {
    return surface === "chat" ? "block-return" : "block-persistence";
  }
  if (severity === "critical" || severity === "high") {
    return PERSISTENCE_SURFACES.has(surface) ? "block-persistence" : "redact";
  }
  if (severity === "medium") return "needs-review";
  return "redact";
}

function byteOffset(text: string, index: number): number {
  return Buffer.byteLength(text.slice(0, index));
}

function countSeverity(findings: readonly GuardFinding[]): Record<GuardSeverity, number> {
  const counts: Record<GuardSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

function redactMatch(match: string, label: string): string {
  if (/^(Authorization:\s*)(Bearer|Basic)\s+/i.test(match)) {
    return match.replace(/^(Authorization:\s*)(Bearer|Basic)\s+.+$/i, `$1$2 <redacted:${label}>`);
  }
  if (/^(?:https?:\/\/)/i.test(match)) {
    return match.replace(/^(https?:\/\/)([^:\s/@]+):([^@\s]+)@/i, `$1<user>:<redacted:${label}>@`);
  }
  const assignment = match.match(/^([^=\r\n]{1,80}=\s*)/);
  if (assignment) return `${assignment[1]}<redacted:${label}>`;
  const header = match.match(/^([^:\r\n]{1,80}:\s*)/);
  if (header) return `${header[1]}<redacted:${label}>`;
  return `<redacted:${label}>`;
}

function scanRules(text: string, surface: GuardSurface, rules: readonly GuardRule[]): {
  findings: GuardFinding[];
  ranges: Array<{ start: number; end: number; label: string }>;
  counts: Record<string, number>;
} {
  const findings: GuardFinding[] = [];
  const ranges: Array<{ start: number; end: number; label: string }> = [];
  const counts: Record<string, number> = {};

  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const match of text.matchAll(pattern)) {
      const value = match[0] ?? "";
      if (!value) continue;
      const start = match.index ?? 0;
      const end = start + value.length;
      const label = rule.label ?? rule.id.toUpperCase();
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        action: actionFor(surface, rule.severity, rule.id),
        surface,
        confidence: rule.confidence,
        byteStart: byteOffset(text, start),
        byteEnd: byteOffset(text, end),
        redactionLabel: label,
        message: rule.message,
      });
      ranges.push({ start, end, label });
      counts[rule.id] = (counts[rule.id] ?? 0) + 1;
    }
  }

  return { findings, ranges, counts };
}

function applyRedactions(text: string, ranges: Array<{ start: number; end: number; label: string }>): string {
  if (ranges.length === 0) return text;
  const merged = [...ranges]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<Array<{ start: number; end: number; label: string }>>((acc, range) => {
      const last = acc[acc.length - 1];
      if (last && range.start <= last.end) {
        last.end = Math.max(last.end, range.end);
        return acc;
      }
      acc.push({ ...range });
      return acc;
    }, []);

  let out = "";
  let cursor = 0;
  for (const range of merged) {
    out += text.slice(cursor, range.start);
    out += redactMatch(text.slice(range.start, range.end), range.label);
    cursor = range.end;
  }
  out += text.slice(cursor);
  return out;
}

function statusFor(surface: GuardSurface, findings: readonly GuardFinding[], redactedText: string, original: string): GuardDecision["status"] {
  if (findings.some((finding) => finding.action === "block-return" || finding.action === "block-persistence")) {
    return "blocked";
  }
  if (findings.some((finding) => finding.action === "needs-review")) return "needs-review";
  if (redactedText !== original || findings.some((finding) => finding.action === "redact")) return "redacted";
  return "allow";
}

export function scanGuardText(text: string, surface: GuardSurface = "chat"): GuardDecision {
  try {
    const secret = scanRules(text, surface, SECRET_RULES);
    const controls = scanRules(text, surface, CONTROL_RULES);
    const instructions = scanRules(text, surface, INSTRUCTION_RULES);
    const findings = [...secret.findings, ...controls.findings, ...instructions.findings]
      .sort((a, b) => (a.byteStart ?? 0) - (b.byteStart ?? 0) || a.ruleId.localeCompare(b.ruleId));
    const ranges = [...secret.ranges, ...controls.ranges, ...instructions.ranges];
    const counts: Record<string, number> = {};
    for (const source of [secret.counts, controls.counts, instructions.counts]) {
      for (const [ruleId, count] of Object.entries(source)) counts[ruleId] = (counts[ruleId] ?? 0) + count;
    }
    const redactedText = applyRedactions(text, ranges);
    return {
      schemaVersion: 1,
      guardVersion: GUARD_VERSION,
      surface,
      status: statusFor(surface, findings, redactedText, text),
      findings,
      redactedText,
      counts,
    };
  } catch (err) {
    return {
      schemaVersion: 1,
      guardVersion: GUARD_VERSION,
      surface,
      status: "unavailable",
      findings: [],
      counts: {},
      warnings: [`guard scanner failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

export function scanGuardBuffer(buffer: Buffer, surface: GuardSurface = "chat"): GuardDecision {
  const nulCount = buffer.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  const nulRatio = buffer.length > 0 ? nulCount / buffer.length : 0;
  const text = buffer.toString("utf8");
  const decision = scanGuardText(text, surface);
  if (nulRatio <= 0.01) return decision;

  const binaryFinding: GuardFinding = {
    ruleId: "binary_like_payload",
    severity: "critical",
    action: surface === "chat" ? "block-return" : "block-persistence",
    surface,
    confidence: "high",
    message: "binary-like payload detected",
  };
  const findings = [binaryFinding, ...decision.findings];
  return {
    ...decision,
    status: "blocked",
    findings,
    counts: {
      ...decision.counts,
      binary_like_payload: 1,
    },
  };
}

export function createGuardScanReport(subjects: Array<{ surface: GuardSurface; pathOrId: string; decision: GuardDecision }>, now = new Date()): GuardScanReport {
  const totals: Record<GuardSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const subject of subjects) {
    const counts = countSeverity(subject.decision.findings);
    for (const severity of Object.keys(totals) as GuardSeverity[]) totals[severity] += counts[severity];
  }
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    guardVersion: GUARD_VERSION,
    subjects: subjects.map((subject) => ({
      surface: subject.surface,
      pathOrId: subject.pathOrId,
      status: subject.decision.status,
      findings: subject.decision.findings.length,
    })),
    totals,
    failed: totals.critical > 0
      || totals.high > 0
      || subjects.some((subject) => ["blocked", "needs-review", "unavailable"].includes(subject.decision.status)),
  };
}

export function guardSeverityTotals(findings: readonly GuardFinding[]): Record<GuardSeverity, number> {
  return countSeverity(findings);
}
