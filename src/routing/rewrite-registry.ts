import { classifyCommand } from "./command-classifier.js";
import { COMMAND_COVERAGE, findCoverageEntry } from "./command-coverage.js";
import type {
  ClassifiedCommand,
  RejectedRouteRule,
  RouteDecision,
  RoutePlan,
  RouteRule,
  RouterMode,
  RuleMatch,
} from "./types.js";

export interface RouteCommandOptions {
  mode?: RouterMode;
  adapterCanRewrite?: boolean;
}

function hasAnyFlag(command: ClassifiedCommand, flags: readonly string[]): string[] {
  return command.argv.filter((arg) => flags.includes(arg) || flags.some((flag) => arg.startsWith(`${flag}=`)));
}

function simpleStarts(command: ClassifiedCommand, tokens: readonly string[]): boolean {
  return tokens.every((tok, idx) => (command.argv[idx] ?? "").toLowerCase() === tok);
}

function route(tool: RoutePlan["tool"], parser: string, command: ClassifiedCommand, summary: string, mode?: string): RoutePlan {
  return {
    tool,
    parser,
    mode,
    command: command.redactedShape,
    summary,
  };
}

function redactedSegments(command: ClassifiedCommand): ClassifiedCommand["segments"] {
  return command.segments.map((segment) => ({
    ...segment,
    rawShape: segment.redactedShape,
  }));
}

export const REWRITE_RULES: readonly RouteRule[] = [
  {
    id: "git-status",
    priority: 90,
    command: "git status",
    parser: "git-status",
    category: "git",
    dangerLevel: "low",
    autoRewriteEligible: true,
    supportsJsonFirst: false,
    knownFlagConflicts: ["--porcelain=v2", "-z"],
    match(command) {
      if (!simpleStarts(command, ["git", "status"])) return null;
      return { confidence: 0.93, reasons: ["git status has compact status parser"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "git-status", command, "Summarize branch, dirty files, and untracked counts.");
    },
  },
  {
    id: "git-diff",
    priority: 85,
    command: "git diff",
    parser: "git-diff",
    category: "git",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: ["--binary", "--ext-diff", "--word-diff"],
    match(command) {
      if (!simpleStarts(command, ["git", "diff"])) return null;
      return { confidence: 0.88, reasons: ["git diff can be compacted by file and hunk"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "git-diff", command, "Return compact diff summary plus important hunks.");
    },
  },
  {
    id: "rg-search",
    priority: 82,
    command: "rg",
    parser: "rg",
    category: "search",
    dangerLevel: "low",
    autoRewriteEligible: true,
    supportsJsonFirst: true,
    knownFlagConflicts: ["--json", "--files", "--count", "--passthru"],
    match(command) {
      if (command.firstToken !== "rg") return null;
      const flags = hasAnyFlag(command, ["--json"]);
      return {
        confidence: flags.length ? 0.96 : 0.86,
        reasons: flags.length ? ["user already requested JSON output"] : ["rg output can be grouped by file"],
        existingStructuredFlag: flags.length > 0,
        matchedFlags: flags,
      };
    },
    buildRoute(command) {
      return route("ctx_execute", "rg", command, "Group matches by file with bounded previews.");
    },
  },
  {
    id: "grep-search",
    priority: 78,
    command: "grep",
    parser: "grep",
    category: "search",
    dangerLevel: "low",
    autoRewriteEligible: true,
    supportsJsonFirst: false,
    knownFlagConflicts: ["-z", "--binary-files", "--line-buffered"],
    match(command) {
      if (!["grep", "egrep", "fgrep"].includes(command.firstToken)) return null;
      return { confidence: 0.75, reasons: ["grep output can be grouped and capped"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "grep", command, "Group matches by file with bounded previews.");
    },
  },
  {
    id: "cat-read",
    priority: 76,
    command: "cat",
    parser: "ctx-read",
    category: "file",
    dangerLevel: "medium",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: ["-"],
    match(command) {
      if (!["cat", "type", "get-content"].includes(command.firstToken)) return null;
      if (command.argv.includes("-")) {
        return { confidence: 0.2, reasons: ["stdin read must stay classify-only"] };
      }
      return { confidence: 0.82, reasons: ["file read can route to ctx_read outline/slice"] };
    },
    buildRoute(command) {
      const target = command.argv.slice(1).join(" ");
      return {
        tool: "ctx_read",
        parser: "ctx-read",
        mode: "outline",
        command: command.redactedShape,
        summary: `Read ${target || "<file>"} with outline-first mode.`,
      };
    },
  },
  {
    id: "node-test-existing-json-reporter",
    priority: 88,
    command: "pnpm test",
    parser: "vitest-json",
    category: "test",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: true,
    knownFlagConflicts: ["--watch", "--ui", "--reporter"],
    match(command) {
      if (!["npm", "pnpm", "yarn", "vitest"].includes(command.firstToken)) return null;
      if (!/\b(test|vitest)\b/i.test(command.normalized)) return null;
      const flags = hasAnyFlag(command, ["--reporter", "--outputFile", "--json"]);
      if (flags.length === 0) return null;
      return {
        confidence: 0.94,
        reasons: ["user supplied structured reporter/output flag"],
        existingStructuredFlag: true,
        matchedFlags: flags,
      };
    },
    buildRoute(command, match) {
      return route(
        "ctx_execute",
        "vitest-json",
        command,
        `Parse existing structured test output (${match.matchedFlags?.join(", ") || "reporter flag"}).`,
      );
    },
  },
  {
    id: "node-test-generic",
    priority: 72,
    command: "npm test",
    parser: "node-test-generic",
    category: "test",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: true,
    knownFlagConflicts: ["--watch", "--ui", "--reporter"],
    match(command) {
      if (!["npm", "pnpm", "yarn", "vitest"].includes(command.firstToken)) return null;
      if (!/\b(test|vitest)\b/i.test(command.normalized)) return null;
      return { confidence: 0.76, reasons: ["test output can be failure-focused"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "node-test-generic", command, "Return failure-only test summary.");
    },
  },
  {
    id: "pytest",
    priority: 72,
    command: "pytest",
    parser: "pytest",
    category: "test",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: true,
    knownFlagConflicts: ["-f", "--looponfail", "--pdb", "-s"],
    match(command) {
      if (command.firstToken !== "pytest" && !command.normalized.includes(" pytest")) return null;
      return { confidence: 0.78, reasons: ["pytest output can be failure-focused"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "pytest", command, "Return failure-only pytest summary.");
    },
  },
  {
    id: "network-fetch-classify-only",
    priority: 95,
    command: "curl",
    parser: "fetch-policy",
    category: "network",
    dangerLevel: "high",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: ["-d", "--data", "-H", "--header", "-u", "--user", "-k", "--insecure"],
    match(command) {
      if (!["curl", "wget"].includes(command.firstToken)) return null;
      return { confidence: 0.9, reasons: ["network command requires fetch policy and SSRF checks"] };
    },
    buildRoute(command) {
      return route("ctx_fetch_and_index", "fetch-policy", command, "Recommendation only until URL policy passes.");
    },
  },
];

function safetyFor(command: ClassifiedCommand, rule: RouteRule | undefined, match: RuleMatch | undefined, opts: RouteCommandOptions) {
  if (opts.mode === "off") return { autoRewriteEligible: false, reason: "router mode is off" };
  if (command.interactivity.interactiveRisk !== "none") {
    return { autoRewriteEligible: false, reason: `interactive risk is ${command.interactivity.interactiveRisk}` };
  }
  if (command.input.stdinPresent) return { autoRewriteEligible: false, reason: "stdin/heredoc/pipeline input present" };
  if (command.hasCompoundOperators) return { autoRewriteEligible: false, reason: "compound commands are classify-only" };
  if (command.hasRedirection) return { autoRewriteEligible: false, reason: "redirection changes observable behavior" };
  if (command.hasSubshell) return { autoRewriteEligible: false, reason: "subshell or command substitution present" };
  if (!rule || !match) return { autoRewriteEligible: false, reason: "no matching route rule" };
  if (rule.dangerLevel !== "low") return { autoRewriteEligible: false, reason: `danger level ${rule.dangerLevel}` };
  if (match.existingStructuredFlag) return { autoRewriteEligible: false, reason: "existing structured/reporter flag supplied by user" };
  const conflictingFlags = rule.knownFlagConflicts.filter((flag) =>
    command.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
  );
  if (conflictingFlags.length > 0) {
    return { autoRewriteEligible: false, reason: `known flag conflict: ${conflictingFlags.join(", ")}` };
  }
  if (!rule.autoRewriteEligible) return { autoRewriteEligible: false, reason: "rule is recommendation-only" };
  if (!opts.adapterCanRewrite) return { autoRewriteEligible: false, reason: "adapter cannot rewrite input safely" };
  return { autoRewriteEligible: true, reason: "allowlisted simple command and adapter can rewrite" };
}

export function routeCommand(commandText: string, opts: RouteCommandOptions = {}): RouteDecision {
  const mode = opts.mode ?? "recommend";
  const command = classifyCommand(commandText);
  const matches = REWRITE_RULES
    .map((rule) => ({ rule, match: rule.match(command) }))
    .filter((item): item is { rule: RouteRule; match: RuleMatch } => item.match !== null)
    .sort((a, b) => b.rule.priority - a.rule.priority);

  const selected = matches[0];
  const rejectedRules: RejectedRouteRule[] = [];
  for (const item of matches.slice(1)) {
    rejectedRules.push({
      rule: item.rule.id,
      reason: selected ? `lower priority than ${selected.rule.id}` : "not selected",
    });
  }

  if (!selected) {
    const safety = safetyFor(command, undefined, undefined, opts);
    return {
      decision: mode === "off" || safety.reason === "no matching route rule" ? "pass-through" : "classify-only",
      confidence: 0,
      rejectedRules,
      safety,
      adapterCapabilityReason: opts.adapterCanRewrite ? "adapter can rewrite" : "adapter rewrite capability absent or unknown",
      interactivity: command.interactivity,
      input: command.input,
      segments: redactedSegments(command),
      diagnostics: ["no matching rule"],
    };
  }

  const safety = safetyFor(command, selected.rule, selected.match, { ...opts, mode });
  const coverage = findCoverageEntry(selected.rule.command);
  const routePlan = selected.rule.buildRoute(command, selected.match);
  const diagnostics: string[] = [];
  if (!coverage) diagnostics.push(`coverage manifest missing for ${selected.rule.command}`);
  for (const flag of selected.rule.knownFlagConflicts) {
    if (command.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) {
      diagnostics.push(`known flag conflict: ${flag}`);
    }
  }

  const shapeRequiresClassification =
    command.interactivity.interactiveRisk !== "none"
    || command.input.stdinPresent
    || command.hasCompoundOperators
    || command.hasRedirection
    || command.hasSubshell;
  const decision =
    mode === "off"
      ? "pass-through"
      : shapeRequiresClassification
        ? "classify-only"
        : mode === "rewrite" && safety.autoRewriteEligible
          ? "rewrite"
          : "recommend";

  return {
    decision,
    selectedRule: selected.rule.id,
    priority: selected.rule.priority,
    confidence: selected.match.confidence,
    route: routePlan,
    rejectedRules,
    safety,
    adapterCapabilityReason: opts.adapterCanRewrite ? "adapter can rewrite" : "adapter rewrite capability absent or unknown",
    interactivity: command.interactivity,
    input: command.input,
    segments: redactedSegments(command),
    diagnostics,
  };
}

export function explainRoute(commandText: string, opts: RouteCommandOptions = {}): string {
  return JSON.stringify(routeCommand(commandText, opts), null, 2);
}

export { COMMAND_COVERAGE };
