import { classifyCommand, gitSubcommand } from "./command-classifier.js";
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

function canonicalToken(token: string | undefined): string {
  const base = (token ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase() ?? "";
  return base.replace(/\.(?:cmd|exe|bat|ps1)$/i, "");
}

function arg(command: ClassifiedCommand, index: number): string {
  return canonicalToken(command.argv[index]);
}

function isLeadingEnvAssignment(raw: string | undefined): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw ?? "");
}

function commandStartIndex(command: ClassifiedCommand): number {
  let i = 0;
  while (i < command.argv.length && isLeadingEnvAssignment(command.argv[i])) i++;
  return i;
}

function commandArg(command: ClassifiedCommand, offset: number): string {
  return arg(command, commandStartIndex(command) + offset);
}

function isPackageManager(command: string): boolean {
  return ["npm", "pnpm", "yarn", "bun"].includes(command);
}

function isValueFlag(raw: string, names: readonly string[]): boolean {
  return names.some((name) => raw === name || raw.startsWith(`${name}=`));
}

function skipPackageManagerOptions(command: ClassifiedCommand, index: number): number {
  let i = index;
  while (i < command.argv.length) {
    const raw = command.argv[i] ?? "";
    if (raw === "--") return i + 1;
    if (isValueFlag(raw, ["--prefix", "--workspace", "--filter", "--cwd", "--dir", "-C", "-w"])) {
      i += raw.includes("=") ? 1 : 2;
      continue;
    }
    if (["--silent", "--if-present", "--recursive", "-r"].includes(raw)) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

function skipNpxOptions(command: ClassifiedCommand, index: number): number {
  let i = index;
  while (i < command.argv.length) {
    const raw = command.argv[i] ?? "";
    if (raw === "--") return i + 1;
    if (isValueFlag(raw, ["--package", "-p", "--cache", "--userconfig"])) {
      i += raw.includes("=") ? 1 : 2;
      continue;
    }
    if (["--yes", "-y", "--no-install", "--quiet", "-q"].includes(raw)) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

function hasFlagFrom(command: ClassifiedCommand, start: number, flags: readonly string[]): boolean {
  return command.argv.slice(start).some((raw) => {
    const token = canonicalToken(raw);
    return flags.includes(raw) || flags.includes(token) || flags.some((flag) => raw.startsWith(`${flag}=`));
  });
}

function reporterValues(command: ClassifiedCommand): string[] {
  const values: string[] = [];
  for (let i = commandStartIndex(command); i < command.argv.length; i++) {
    const raw = command.argv[i] ?? "";
    const eq = raw.match(/^--reporter=(.+)$/);
    if (eq?.[1]) {
      values.push(eq[1].toLowerCase());
      continue;
    }
    if (raw === "--reporter" && command.argv[i + 1]) {
      values.push((command.argv[i + 1] ?? "").toLowerCase());
    }
  }
  return values;
}

function hasJsonReporter(command: ClassifiedCommand): boolean {
  if (hasAnyFlag(command, ["--json"]).length > 0) return true;
  return reporterValues(command).some((value) => value.split(",").includes("json"));
}

function npxExecutable(command: ClassifiedCommand): string {
  const start = commandStartIndex(command);
  if (arg(command, start) !== "npx") return "";
  return arg(command, skipNpxOptions(command, start + 1));
}

function packageSubcommand(command: ClassifiedCommand): string {
  const start = commandStartIndex(command);
  const first = arg(command, start);
  if (!isPackageManager(first)) return "";
  return arg(command, skipPackageManagerOptions(command, start + 1));
}

function simpleStarts(command: ClassifiedCommand, tokens: readonly string[]): boolean {
  const start = commandStartIndex(command);
  return tokens.every((tok, idx) => arg(command, start + idx) === tok);
}

function isVitestCommand(command: ClassifiedCommand): boolean {
  const start = commandStartIndex(command);
  const first = arg(command, start);
  if (first === "vitest") return true;
  if (npxExecutable(command) === "vitest") return true;
  const subcommand = packageSubcommand(command);
  if (subcommand === "vitest") return true;
  if (subcommand !== "run") return false;
  return /^vitest(?::|$)/i.test(command.argv[skipPackageManagerOptions(command, start + 1) + 1] ?? "");
}

function isPlaywrightCommand(command: ClassifiedCommand): boolean {
  const start = commandStartIndex(command);
  const first = arg(command, start);
  if (first === "playwright") return arg(command, start + 1) === "test";
  if (npxExecutable(command) === "playwright") {
    const executableIndex = skipNpxOptions(command, start + 1);
    return arg(command, executableIndex + 1) === "test";
  }
  const subcommand = packageSubcommand(command);
  if (subcommand === "playwright") return arg(command, skipPackageManagerOptions(command, start + 1) + 1) === "test";
  if (subcommand !== "run") return false;
  return /^playwright(?::|$)/i.test(command.argv[skipPackageManagerOptions(command, start + 1) + 1] ?? "");
}

function isNodeTestCommand(command: ClassifiedCommand): boolean {
  const start = commandStartIndex(command);
  const first = arg(command, start);
  const packageManagerIndex = isPackageManager(first) ? skipPackageManagerOptions(command, start + 1) : start + 1;
  const second = arg(command, packageManagerIndex);
  if (first === "npx") {
    const executableIndex = skipNpxOptions(command, start + 1);
    const executable = arg(command, executableIndex);
    if (executable === "vitest") return true;
    if (["node", "tsx"].includes(executable)) {
      return hasFlagFrom(command, executableIndex + 1, ["--test"]);
    }
    return false;
  }
  if (first === "vitest") return true;
  if (!isPackageManager(first)) return false;
  if (["test", "t", "vitest"].includes(second)) return true;
  if (second !== "run") return false;
  const script = command.argv[packageManagerIndex + 1] ?? "";
  return /^test(?::|$)/i.test(script) || /^vitest(?::|$)/i.test(script);
}

function nodeScriptName(command: ClassifiedCommand): string {
  const start = commandStartIndex(command);
  const first = arg(command, start);
  if (!isPackageManager(first)) return "";
  const scriptIndex = skipPackageManagerOptions(command, start + 1);
  const second = arg(command, scriptIndex);
  if (first === "npm") {
    if (second === "run" || second === "run-script") return arg(command, scriptIndex + 1);
    return second === "start" ? second : "";
  }
  if (second === "run") return arg(command, scriptIndex + 1);
  return second;
}

function isNodeBuildCommand(command: ClassifiedCommand): boolean {
  return /^build(?::|$)/i.test(nodeScriptName(command));
}

function isNodeTypecheckCommand(command: ClassifiedCommand): boolean {
  const start = commandStartIndex(command);
  const first = arg(command, start);
  if (first === "tsc") return true;
  if (first === "npx") {
    const executable = arg(command, skipNpxOptions(command, start + 1));
    if (executable === "tsc") return true;
  }
  return /^(typecheck|type-check|check:types|tsc)(?::|$)/i.test(nodeScriptName(command));
}

function isNodeDevServerCommand(command: ClassifiedCommand): boolean {
  return /^(dev|start|serve|preview)(?::|$)/i.test(nodeScriptName(command));
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

function segmentRouteRecommendations(command: ClassifiedCommand, opts: RouteCommandOptions) {
  return command.segments
    .filter((segment) => !segment.classificationOnly)
    .map((segment) => {
      const decision = routeCommand(segment.rawShape, {
        ...opts,
        mode: opts.mode === "off" ? "off" : "recommend",
      });
      if (!decision.route) return null;
      return {
        segmentIndex: segment.index,
        command: segment.redactedShape,
        decision: decision.decision,
        selectedRule: decision.selectedRule,
        confidence: decision.confidence,
        route: decision.route,
        safety: decision.safety,
        diagnostics: decision.diagnostics,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
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
      if (gitSubcommand(command.argv) !== "status") return null;
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
      if (gitSubcommand(command.argv) !== "diff") return null;
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
      if (commandArg(command, 0) !== "rg") return null;
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
      if (!["grep", "egrep", "fgrep"].includes(commandArg(command, 0))) return null;
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
      if (!["cat", "type", "get-content"].includes(commandArg(command, 0))) return null;
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
      if (!isNodeTestCommand(command)) return null;
      if (!hasJsonReporter(command)) return null;
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
    id: "playwright-existing-json-reporter",
    priority: 88,
    command: "playwright test",
    parser: "playwright-json",
    category: "test",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: true,
    knownFlagConflicts: ["--debug", "--headed", "--ui"],
    match(command) {
      if (!isPlaywrightCommand(command)) return null;
      if (!hasJsonReporter(command)) return null;
      const flags = hasAnyFlag(command, ["--reporter", "--json"]);
      return {
        confidence: 0.93,
        reasons: ["user supplied Playwright JSON reporter flag"],
        existingStructuredFlag: true,
        matchedFlags: flags,
      };
    },
    buildRoute(command, match) {
      return route(
        "ctx_execute",
        "playwright-json",
        command,
        `Parse existing structured Playwright output (${match.matchedFlags?.join(", ") || "reporter flag"}).`,
      );
    },
  },
  {
    id: "vitest-test",
    priority: 76,
    command: "vitest",
    parser: "vitest",
    category: "test",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: true,
    knownFlagConflicts: ["--watch", "--ui", "--reporter"],
    match(command) {
      if (!isVitestCommand(command)) return null;
      return { confidence: 0.86, reasons: ["Vitest output has dedicated summary counters"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "vitest", command, "Return compact Vitest file/test counters and failure focus.");
    },
  },
  {
    id: "playwright-test",
    priority: 76,
    command: "playwright test",
    parser: "playwright",
    category: "test",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: true,
    knownFlagConflicts: ["--debug", "--headed", "--ui", "--reporter"],
    match(command) {
      if (!isPlaywrightCommand(command)) return null;
      return { confidence: 0.85, reasons: ["Playwright output has dedicated summary counters"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "playwright", command, "Return compact Playwright pass/fail/skip counters and failure focus.");
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
      if (!isNodeTestCommand(command)) return null;
      return { confidence: 0.76, reasons: ["test output can be failure-focused"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "node-test-generic", command, "Return failure-only test summary.");
    },
  },
  {
    id: "node-typecheck-generic",
    priority: 73,
    command: "npx tsc",
    parser: "generic-failure",
    category: "typecheck",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: ["--watch", "-w"],
    match(command) {
      if (!isNodeTypecheckCommand(command)) return null;
      return { confidence: 0.77, reasons: ["typecheck output can be failure-focused and sidecar-backed"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "generic-failure", command, "Return failure-focused typecheck summary with raw log in a sidecar.");
    },
  },
  {
    id: "node-build-generic",
    priority: 71,
    command: "npm run build",
    parser: "generic-failure",
    category: "build",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: ["--watch"],
    match(command) {
      if (!isNodeBuildCommand(command)) return null;
      return { confidence: 0.74, reasons: ["build output can be failure-focused and sidecar-backed"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "generic-failure", command, "Return failure-focused build summary with raw log in a sidecar.");
    },
  },
  {
    id: "node-dev-server",
    priority: 69,
    command: "npm run dev",
    parser: "generic-failure",
    category: "dev-server",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: [],
    match(command) {
      if (!isNodeDevServerCommand(command)) return null;
      return { confidence: 0.7, reasons: ["dev server output is long-running and should stay sidecar-backed"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "generic-failure", command, "Run long-running dev server through ctx_execute/background and keep logs out of context.");
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
      if (commandArg(command, 0) !== "pytest" && !command.normalized.includes(" pytest")) return null;
      return { confidence: 0.78, reasons: ["pytest output can be failure-focused"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "pytest", command, "Return failure-only pytest summary.");
    },
  },
  {
    id: "cargo-test",
    priority: 72,
    command: "cargo test",
    parser: "generic-failure",
    category: "test",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: true,
    knownFlagConflicts: ["--watch", "--nocapture"],
    match(command) {
      if (!simpleStarts(command, ["cargo", "test"])) return null;
      return { confidence: 0.77, reasons: ["cargo test output can be failure-focused"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "generic-failure", command, "Return failure-only cargo test summary.");
    },
  },
  {
    id: "graphify",
    priority: 70,
    command: "graphify",
    parser: "generic-failure",
    category: "graph",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: ["--watch"],
    match(command) {
      if (commandArg(command, 0) !== "graphify") return null;
      return { confidence: 0.74, reasons: ["graphify output can be large and should be sidecar-backed"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "generic-failure", command, "Run graphify through ctx_execute with compact output and sidecar storage.");
    },
  },
  {
    id: "openclaw-status-logs",
    priority: 70,
    command: "openclaw status",
    parser: "generic-failure",
    category: "agent-status",
    dangerLevel: "low",
    autoRewriteEligible: false,
    supportsJsonFirst: false,
    knownFlagConflicts: ["--watch", "--follow", "-f"],
    match(command) {
      if (commandArg(command, 0) !== "openclaw") return null;
      if (!["status", "logs", "log"].includes(commandArg(command, 1))) return null;
      return { confidence: 0.73, reasons: ["OpenClaw status/log output can be large and should stay sidecar-backed"] };
    },
    buildRoute(command) {
      return route("ctx_execute", "generic-failure", command, "Run OpenClaw status/log commands through ctx_execute with compact output and sidecar storage.");
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
      if (!["curl", "wget"].includes(commandArg(command, 0))) return null;
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
  if (command.hasCompoundOperators) {
    const safety = safetyFor(command, undefined, undefined, { ...opts, mode });
    const segmentRoutes = segmentRouteRecommendations(command, { ...opts, mode });
    return {
      decision: mode === "off" ? "pass-through" : "classify-only",
      confidence: 0,
      rejectedRules: [],
      safety,
      adapterCapabilityReason: opts.adapterCanRewrite ? "adapter can rewrite" : "adapter rewrite capability absent or unknown",
      interactivity: command.interactivity,
      input: command.input,
      segments: redactedSegments(command),
      ...(segmentRoutes.length > 0 ? { segmentRoutes } : {}),
      diagnostics: [
        "compound command: route individual segments instead",
        ...(segmentRoutes.length > 0
          ? [`segment route recommendations available: ${segmentRoutes.length}`]
          : []),
      ],
    };
  }
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
  if (
    safety.reason === "adapter cannot rewrite input safely"
    && mode !== "rewrite"
    && selected.rule.autoRewriteEligible
  ) {
    diagnostics.push("route recommendation remains valid; adapter capability only controls automatic rewrite");
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
