export type ShellDialect = "posix" | "powershell" | "cmd" | "unknown";

export type RouteDecisionKind =
  | "pass-through"
  | "recommend"
  | "rewrite"
  | "block"
  | "classify-only";

export type RouterMode = "off" | "recommend" | "rewrite";

export type ConfidenceLabel = "high" | "medium" | "low";

export interface InteractivitySignals {
  requiresTty: boolean;
  usesStdin: boolean;
  isLongRunning: boolean;
  isWatchMode: boolean;
  interactiveRisk: "none" | "possible" | "likely";
}

export interface CommandInput {
  stdinPresent: boolean;
  stdinBytes: number;
  stdinHash?: string;
  stdinRedactedShape?: string;
  heredocDetected: boolean;
  stdinPersisted: false;
}

export interface CommandSegment {
  id: string;
  parentRunId: string;
  index: number;
  dialect: ShellDialect;
  rawShape: string;
  redactedShape: string;
  operatorsBefore: string[];
  operatorsAfter: string[];
  hasSideEffects: boolean;
  classificationOnly: boolean;
}

export interface ParserResult {
  parserName: string;
  parserVersion: string;
  parserKind: string;
  confidence: {
    label: ConfidenceLabel;
    score: number;
    reasons: string[];
  };
  parseFailure: boolean;
  exitCode: number | null;
  stdoutBytes: number;
  stderrBytes: number;
  unparsedBytes: number;
  truncated: boolean;
  redactionVersion: string;
  redactionCounts: Record<string, number>;
}

export interface RunArtifact {
  artifactId: string;
  runId: string;
  sessionId: string;
  projectId: string;
  kind: "redacted-raw-output" | "json" | "log" | "report";
  displayPath: string;
  localPath: string;
  contentHash: string;
  redactionVersion: string;
  createdAt: string;
  expiresAt: string;
  cleanupState: "active" | "expired" | "deleted";
}

export interface AnalyticsEvent {
  eventId: string;
  sessionId: string;
  adapter: string;
  commandCategory: string;
  redactedArgvShape: string;
  commandHash: string;
  parserName?: string;
  parserVersion?: string;
  rawBytes: number;
  returnedBytes: number;
  artifactId?: string;
}

export interface CommandCoverageEntry {
  command: string;
  ecosystem: string;
  status: "planned" | "experimental" | "supported" | "disabled";
  router: RouterMode;
  parser: string;
  autoRewriteEligible: boolean;
  supportsJsonFirst: boolean;
  dangerLevel: "low" | "medium" | "high";
  knownFlagConflicts: string[];
  fixtures: string[];
}

export interface RouteRule {
  id: string;
  priority: number;
  command: string;
  parser: string;
  category: string;
  dangerLevel: "low" | "medium" | "high";
  autoRewriteEligible: boolean;
  supportsJsonFirst: boolean;
  knownFlagConflicts: string[];
  match(command: ClassifiedCommand): RuleMatch | null;
  buildRoute(command: ClassifiedCommand, match: RuleMatch): RoutePlan;
}

export interface RuleMatch {
  confidence: number;
  reasons: string[];
  existingStructuredFlag?: boolean;
  matchedFlags?: string[];
}

export interface RoutePlan {
  tool: "ctx_execute" | "ctx_batch_execute" | "ctx_execute_file" | "ctx_read" | "ctx_fetch_and_index" | "passthrough";
  parser?: string;
  mode?: string;
  command?: string;
  summary: string;
}

export interface RejectedRouteRule {
  rule: string;
  reason: string;
}

export interface RouteSafety {
  autoRewriteEligible: boolean;
  reason: string;
}

export interface ClassifiedCommand {
  raw: string;
  normalized: string;
  dialect: ShellDialect;
  runId: string;
  firstToken: string;
  argv: string[];
  segments: CommandSegment[];
  interactivity: InteractivitySignals;
  input: CommandInput;
  hasCompoundOperators: boolean;
  hasRedirection: boolean;
  hasSubshell: boolean;
  hasEnvAssignment: boolean;
  redactedShape: string;
}

export interface RouteDecision {
  decision: RouteDecisionKind;
  selectedRule?: string;
  priority?: number;
  confidence: number;
  route?: RoutePlan;
  segmentRoutes?: Array<{
    segmentIndex: number;
    command: string;
    decision: RouteDecisionKind;
    selectedRule?: string;
    confidence: number;
    route?: RoutePlan;
    safety: RouteSafety;
    diagnostics: string[];
  }>;
  rejectedRules: RejectedRouteRule[];
  safety: RouteSafety;
  adapterCapabilityReason?: string;
  interactivity: InteractivitySignals;
  input: CommandInput;
  segments: CommandSegment[];
  diagnostics: string[];
}
