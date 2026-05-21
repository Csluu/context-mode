# RTK-Inspired Context Mode Spec

Status: draft
Date: 2026-05-17

## Goal

Turn context-mode from a set of helpful MCP tools into the routing and output firewall layer for agent work.

RTK is useful because it compresses noisy command output, tracks savings, and provides hook/install fallbacks. Context-mode can go further because it already owns richer primitives: `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_fetch_and_index`, `ctx_index`, session analytics, FTS-backed content storage, adapter installers, and hook guidance.

Target result:

```text
agent intent or raw command
  -> context-mode router
  -> rewrite registry
  -> best tool/parser/filter
  -> compact structured response in chat
  -> full raw artifact stored outside chat when needed
  -> analytics event for savings and missed routes
```

## Sources Checked

- RTK GitHub repository page, fetched 2026-05-17.
- RTK `README.md` from `master`, fetched 2026-05-17.
- RTK `LICENSE` from `master`, fetched 2026-05-17.
- RTK telemetry docs from `master`, fetched 2026-05-17.
- Local context-mode repo structure and indexed code summaries.
- Difftastic documentation, checked 2026-05-17, for syntax-aware diff behavior and textual fallback expectations: https://difftastic.com/
- OpenTelemetry GenAI semantic conventions, checked 2026-05-17, for token and tool trace field alignment: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- Nx and Turborepo caching documentation, checked 2026-05-17, for input/env/output fingerprint principles: https://nx.dev/reference/inputs and https://turborepo.com/docs/core-concepts/caching
- Bazel remote caching documentation, checked 2026-05-17, for action-output cache semantics: https://bazel.build/remote/caching
- Gitleaks, Semgrep, and Trivy documentation, checked 2026-05-17, for secret scanning, rule syntax, and license/secret scanner patterns: https://github.com/gitleaks/gitleaks, https://semgrep.dev/docs/writing-rules/rule-syntax, and https://trivy.dev/latest/docs/scanner/license/

License note: RTK README currently says MIT, while the fetched `LICENSE` file is Apache License 2.0. Treat RTK as architectural inspiration. Do not copy code until license attribution and compatibility are resolved.

## Current Implementation Status

Implemented in this branch:

- Passive command classifier and rewrite registry.
- Route explain JSON for `context-mode route --explain <command>`.
- Rewrite simulation JSON for `context-mode rewrite <command>`.
- Command coverage manifest for supported command shapes.
- Runtime hardening types for command input, interactivity, route safety, artifacts, parser results, and analytics events.
- Layered context-mode config schema with project restrictions.
- Fail-open filter pipeline with ANSI stripping, secret redaction, and failure-focus extraction.
- Parser registry with generic failure, git status, git diff, and rg/grouped-search parsers.
- Explicit opt-in `ctx_execute` parser support with fail-open fallback for unknown or failed parsers.
- `ctx_route` MCP tool for passive route explanations.
- Redacted raw-output sidecar store with atomic writes, listing, fetching, truncation, and pinning.
- `ctx_fetch_run` MCP tool for sidecar list/fetch/raw-preview workflows.
- Automatic `ctx_execute` sidecar writes for intent-indexed and large compacted outputs.
- `ctx_read` MCP tool with auto, map, outline, slice, symbols, and full modes.
- `ctx_read` path containment, binary blocking, slice caps, and full-read reason requirement.
- `ctx_read` repeated unchanged large-read collapse with file hash output.
- `ctx_read` higher-fidelity TypeScript compiler symbol provider with heuristic fallback.
- `ctx_gain` MCP tool for current-session returned/kept-out/sidecar savings.
- Current-session `ctx_gain` includes per-tool latency totals, averages, and max latency.
- `ctx_discover` MCP tool for current-session noisy-tool findings, sidecar volume, and explicit bypass observability gaps.
- Persistent session events for route decisions, parser runs, and per-tool latency telemetry.
- Historical `ctx_gain` and `ctx_discover` views over persisted route/parser/latency telemetry by latest session, explicit session id, or recent day window.
- `context-mode run [--parser <name>] -- <command>` CLI wrapper that preserves the wrapped command exit code, renders parser summaries, and stores full raw sidecar output.
- `context-mode hook test --adapter <id>` self-test for hook observation, recommendation, and opt-in rewrite behavior.
- Hook-shared rewrite registry bundle with fail-open loading for hook runtimes.
- Opt-in hook-side Bash command mutation for low-risk allowlisted routes when `CONTEXT_MODE_ROUTER_MODE=rewrite` or `CONTEXT_MODE_HOOK_REWRITE=1` is set.
- Adapter contract probes cover stable mutation adapters, experimental opt-in adapters, unsupported adapters, and raw-mode kill-switch behavior before hook mutation is enabled by default.
- Adapter-specific output budget manifest and `trackResponse` enforcement for max returned bytes with explicit truncation markers.
- Parser-specific confidence metadata rendered in compact output, persisted in parser-run telemetry, and stored on run sidecar metadata.
- Parser/search/sidecar output shaping respects adapter `maxImportantItems`, `maxSearchMatches`, and `maxSidecarPreviewBytes` where those budgets map directly to the output surface.
- `ctx_discover` bypass taxonomy now distinguishes observable bypasses, native file-tool signals, instruction-only risk, missing hooks, no-mutation hooks, and MCP-available-not-used cases.
- Historical `ctx_gain` and `ctx_discover` telemetry includes adapter/agent actor rollups when events carry adapter or agent metadata.
- `ctx_read` uses a pluggable code-map provider interface with the current heuristic provider reporting provider metadata in read output.
- Local supply-chain release gate scans package/license metadata, approved SPDX-style license expressions, project scripts, dependency lifecycle scripts, direct and transitive dependency licenses, and writes a deterministic SBOM artifact.
- Release package gate creates the actual npm tarball under `release-artifacts/` so checksum/provenance gates cover the published artifact, not just loose bundle files; generated release metadata is excluded from the tarball.
- Release checksum gate writes `SHA256SUMS` for bundles, SBOM, and npm tarball, then either signs it when `CONTEXT_MODE_SIGN_RELEASE=1` is set or writes an explicit unsigned-release note.
- Release provenance gate writes an in-toto/SLSA-style local provenance statement with artifact subjects, git state, package metadata, builder runtime, and missing-artifact failure behavior; it fails closed on dirty or non-git release provenance unless explicitly overridden for local diagnostics and can sign provenance when release signing is enabled.
- Executor-level stdout/stderr stream tee for sidecar capture before MCP response formatting.
- Sidecar per-run byte caps, truncation metadata, TTL cleanup, project quota cleanup, pinned-artifact retention, stale-metadata fail-open behavior, and current-run retention even under very small project caps.
- `CTX_MODE_ROUTER` documented environment alias, with `CONTEXT_MODE_ROUTER_MODE` retaining precedence.
- `ctx_doctor --json` reports router mode/source and active adapter integration tier.
- Multi-process SessionDB concurrency test covers real separate writers, constructor-time WAL pragma retry, and `ensureSession` retry under lock contention. Telemetry paths use short busy timeouts and fail open so stats cannot stall normal tool calls behind long durable-write retries.
- OpenClaw sidecar tool registry updated for `ctx_route`, `ctx_fetch_run`, `ctx_read`, `ctx_gain`, and `ctx_discover`.
- Focused tests for routing, config, filter behavior, coverage manifest, route concurrency, sidecars, persisted telemetry summaries, CLI run wrapping including argv/cwd/env/stdin/PATH/stderr behavior, hook self-test, hook rewrite behavior, adapter output budgets, and extracted tools.

Explicitly future-scoped, not required for the first implementation slice:

- Additional `ctx_read` providers beyond the current TypeScript compiler and heuristic providers, such as Tree-sitter, language-server-backed references, and Serena-compatible remote symbol providers.
- Adapter-native capture for clients that expose unobservable Read/Grep/Glob tools without hook events; current implementation classifies and reports observable/native bypass risk where the host exposes events.
- Hosted external provenance attestation beyond local checksum/SBOM/provenance gates.
- Broad semantic-diff provider coverage beyond optional Difftastic capability detection and git-text fallback.
- OpenTelemetry export. Local trace-style observability exists, but external telemetry remains off unless separately enabled and reviewed.
- Broad deterministic task-result caching. Only the explicit `tsc --noEmit` canary may serve cache hits; all other families remain explain/bypass until proven.
- Public default MCP exposure for `ctx_guard`, `ctx_eval`, `ctx_trace`, and `ctx_cache`. These exist as CLI/internal/experimental surfaces and are hidden unless `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`.

## Current Context-Mode Fit

Observed local capabilities:

- MCP tools already exist for sandbox execution, file processing, search, web indexing, stats, doctor, upgrade, purge, and insight.
- `src/server.ts` still contains large tool handlers with repeated `trackResponse(...)` paths.
- `src/tools/registry.ts` introduces a cleaner tool-definition registration path that wraps `trackResponse` automatically.
- `src/executor.ts` already controls sandboxed stdout/stderr, timeout, background execution, and byte caps.
- `src/session/analytics.ts` already tracks context savings, tool usage, bytes returned, session continuity, compact rescue, and multi-adapter stats.
- Adapter and hook folders exist for Codex, Claude Code, Cursor, OpenClaw, OpenCode, Pi, Kiro, Gemini CLI, Qwen Code, Zed, JetBrains Copilot, and others.
- Security policy code already handles deny patterns, file path policy, secret-sensitive cases, and fail-open or fail-closed decisions depending on enforcement point.
- `graphify-out/` has been refreshed for code graph inspection; HTML output is skipped because the graph is above the default 5000-node visualization limit.

## Fit To Existing Architecture

This work must extend current context-mode architecture instead of creating parallel systems.

Architecture constraints:

- Shared routing logic must be extracted from existing hook routing and policy code, then reused by hooks, MCP server handlers, tests, docs, and future CLI commands.
- Do not create a second independent router that can drift from `hooks/core/routing.mjs` or command deny policy in `src/security.ts`.
- New MCP tools should follow the `src/tools/*` extraction pattern and `ToolContext` registration path instead of adding more large inline handlers to `src/server.ts`.
- Public MCP surface must stay small. Stable default tools are `ctx_read`, `ctx_fetch_run`, `ctx_gain`, `ctx_discover`, `ctx_route`, `ctx_diff`, and pre-existing execution/search/fetch/stats/admin tools. `ctx_guard`, `ctx_eval`, `ctx_trace`, and `ctx_cache` are experimental-gated until contracts and UX stabilize.
- Parser/filter integration should happen through a `FilterPipeline` seam called by `ctx_execute`, `ctx_execute_file`, and `ctx_batch_execute` after capture/redaction and before response formatting.
- Sidecar capture must start in or immediately around `PolyglotExecutor` streaming output, not after the server has buffered all stdout/stderr.
- Analytics must extend existing session DB and `AnalyticsEngine` event flows before adding any separate analytics store.
- `ctx_read` should be a safe file-map/slice facade over existing path-deny checks and `ctx_execute_file` style sandbox processing, not a second raw file reader.
- Hook/runtime delivery must be explicit: shared routing either ships as plain JS usable by hook `.mjs` files, as a bundled hook artifact, or as a generated decision table covered by `assert-bundle`.
- Adapter tier support must be derived from adapter capability objects and contract tests, not a manually maintained wish list.

## Design Principles

1. Route before executing.
   Prefer rewriting risky or noisy requests into context-mode tools before raw shell/read output is produced.

2. Structured output first.
   Prefer JSON/NDJSON/native structured modes when upstream tools support them. Summarize structure, not terminal text.

3. Lossless sidecar, compact chat.
   Store full raw output outside model context when useful. Return summary, critical details, and a stable pointer.

4. Fail open for productivity, fail closed for secrets.
   Parser or router failure should not block normal work. Secret/path policy failure should prevent caching or returning sensitive content.

5. Analytics must explain missed savings.
   Savings stats are useful, but the best improvement loop is knowing which commands bypassed routing and why.

6. Hook, MCP, and prompt integrations are separate tiers.
   Some clients allow pre-tool rewriting. Some only allow MCP tools or instruction files. Support all three without pretending they are equivalent.

## Non-Goals

- Do not clone RTK or copy RTK code until license compatibility and attribution are reviewed.
- Do not build a general-purpose shell or a perfect shell parser.
- Do not guarantee that compact summaries are lossless without sidecar lookup.
- Do not bypass existing security policy to gain token savings.
- Do not enable external telemetry by default.
- Do not auto-mutate commands in every adapter in the first release.
- Do not replace native tool output for commands where exact output is the requested artifact.
- Do not add another generic vector RAG, repository map, grep replacement, code graph, or symbol search surface. Graphify and Serena already own those jobs.
- Do not cache command results unless the command shape is proven side-effect-free and the cache key includes all correctness-relevant inputs.
- Do not present semantic diffs as authoritative replacement for raw diffs when exact patches, generated files, lockfiles, or binary artifacts matter.

## Compatibility Contract

Existing context-mode tools must remain stable while new routing features are added.

Rules:

- `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_fetch_and_index`, `ctx_index`, `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, and `ctx_purge` keep backward-compatible schemas.
- New stable tools are additive: `ctx_read`, `ctx_route`, `ctx_fetch_run`, `ctx_gain`, `ctx_discover`, and `ctx_diff`.
- New response shapes must include a human-readable summary first and optional structured metadata second.
- Tool output must remain useful in clients that ignore structured content.
- Text output must have golden fixtures for clients that ignore structured metadata.
- Each adapter must publish capability metadata: max payload behavior, structured-content support, pre-tool hook support, post-tool hook support, deny support, input mutation support, and output mutation support.
- Deprecations require a warning period, migration note, and compatibility test.
- Rewrites cannot become default behavior until a feature flag and rollback path exist.
- Sidecar artifact paths must be stable enough for a later `ctx_fetch_run` call, but not promised as permanent archival storage.
- Adapter-specific behavior must be documented in the platform support matrix.

Command semantics preservation:

- Every rewrite must preserve the original command's observable behavior except for reducing, filtering, or formatting the output returned to the model.
- Required preserved behavior: exit code, cwd, environment inheritance and overrides, stdout/stderr separation, timeout behavior, signal behavior, stdin behavior, TTY behavior, PATH resolution, shell dialect, and command side effects.
- A rewrite is invalid if it changes command side effects, hides permission prompts, changes interactive behavior, prevents observation of meaningful failure, or changes a nonzero exit into a success.
- The wrapper must be transparent to callers that inspect process status. Compact summaries can change chat output, but cannot change the command result used for control flow.
- Auto-rewrite is allowed only after a fixture proves semantic equivalence for the command shape and adapter.

Compatibility tests:

- MCP schema snapshots for all existing tools.
- Fixture tests proving old call shapes still work.
- Adapter smoke tests proving installed guidance still points at valid tool names.
- Golden response tests for compact text plus structured metadata.
- Per-command semantic equivalence tests covering exit code, cwd, env, stdout/stderr split, timeout, signals, stdin, TTY classification, PATH lookup, and shell dialect.

## Runtime Hardening Requirements

These requirements are implementation gates before any command mutation ships.

### Interactive And TTY Policy

Commands requiring TTY, stdin, watch mode, continuous streaming, or user interaction are classify-only by default. Auto-rewrite requires parser-specific proof that passthrough behavior is preserved.

Classify-only by default:

- `npm init`, `pnpm create`, `npm create`, and similar project generators.
- `git rebase -i`, editors and pagers such as `vim`, `nano`, `less`, and `more`.
- `ssh`, `sudo`, and commands that may prompt for credentials.
- `watch`, `tail -f`, `npm run dev`, `vite --watch`, test watch modes, and long-running development servers.

Route decisions must include:

```ts
interface InteractivitySignals {
	requiresTty: boolean;
	usesStdin: boolean;
	isLongRunning: boolean;
	isWatchMode: boolean;
	interactiveRisk: "none" | "possible" | "likely";
}
```

### Route Explainability

Add `ctx_route --explain <command>` and the equivalent programmatic router API before hook rewrite is enabled. Every route decision must expose selected rule id, rule priority, confidence, rejected matching rules, safety reason, adapter capability reason, and auto-rewrite eligibility.

Example:

```json
{
	"decision": "recommend",
	"selectedRule": "pnpm-test-existing-json-reporter",
	"priority": 80,
	"confidence": 0.94,
	"route": "ctx_execute parser=vitest-json command='pnpm test --reporter=json'",
	"rejectedRules": [
		{
			"rule": "pnpm-test-force-json",
			"reason": "user already supplied reporter flag"
		}
	],
	"safety": {
		"autoRewriteEligible": false,
		"reason": "existing reporter flag"
	}
}
```

### CLI Wrapper Surface

MCP tools are not enough. Some clients and agents will reliably call shell commands before they reliably call MCP tools. Add a first-class CLI wrapper surface:

- `context-mode run -- <command>`
- `context-mode rewrite <command>`
- `context-mode route --explain <command>`
- `context-mode read <file> --mode outline`
- `context-mode hook test --adapter <name>`
- `context-mode hook install --adapter <name> --dry-run`
- `context-mode hook uninstall --adapter <name>`

CLI behavior must call the same routing, config, parser, sidecar, and analytics modules as MCP tools and hooks.

The published npm binary is currently `context-mode`. A short `ctx` binary or shell alias is optional packaging work, not a required implementation target for the first rewrite release. Specialized convenience commands such as `context-mode git status`, `context-mode git diff`, and `context-mode rg ...` are useful later, but `context-mode run -- <command>` plus route explanation must land first so every wrapper path shares one semantic-preservation contract.

### Concurrency And Locking

Concurrent agent runs must be safe.

Requirements:

- Run ids are collision-resistant and include enough entropy for simultaneous agents under the same project.
- Sidecar writes are atomic: write temp file, fsync when practical, then rename.
- Artifact readers never observe partial writes.
- Cleanup skips active artifacts and uses lock/lease metadata.
- SQLite writes set a busy timeout and use retry/backoff for transient `SQLITE_BUSY`.
- Analytics failures are fail-open: command execution continues and the event is retried or dropped with a diagnostic counter.
- WAL/SHM cleanup must not delete sidecars for a live DB.
- Per-agent, per-session, and per-project quotas are enforced before writing large artifacts.
- Parser registry and config reads are immutable per decision or versioned so parallel updates cannot create half-applied routing.

Required tests:

- 10 concurrent `ctx_execute` calls under one project.
- 3 simulated agents writing sidecars under one project.
- Cleanup running while `ctx_fetch_run` reads an artifact.
- Analytics DB locked: command still succeeds, event is retried or dropped safely.
- Run-id uniqueness under high parallelism.

### Hook Permission Semantics

Hooks must not silently upgrade permissions.

Rules:

- If the original command would require user approval, the rewritten command must preserve that approval requirement.
- Rewriting must not bypass client permission prompts, deny policies, or user-confirmation surfaces.
- If adapter mutation or permission semantics are unclear, use deny-with-suggestion or recommendation-only mode.
- Adapter contract tests must include commands that require approval and prove rewrite does not change the approval boundary.

### Command Coverage Manifest

Every supported command shape must be listed in a versioned manifest.

```json
{
	"command": "pnpm test",
	"ecosystem": "node",
	"status": "experimental",
	"router": "recommend",
	"parser": "vitest-or-generic-test",
	"autoRewriteEligible": false,
	"supportsJsonFirst": true,
	"dangerLevel": "low",
	"knownFlagConflicts": ["--watch", "--ui", "--reporter"],
	"fixtures": ["success", "failure", "empty", "huge", "ansi", "malformed"]
}
```

`ctx doctor` and `ctx_discover` must use this manifest to explain parser coverage, rewrite eligibility, missing fixtures, and known flag conflicts.

### Native Tool Bypass Detection

Document the enforcement limit explicitly: native client tools such as Read, Grep, Glob, search panels, or IDE-specific file APIs may bypass shell hooks. Context-mode cannot guarantee savings unless the adapter can observe, deny, or mutate those tool calls.

`ctx_discover` bypass categories:

- `observable-bypass`
- `unobservable-native-tool`
- `instruction-only-bypass`
- `hook-missing`
- `hook-present-no-mutation`
- `mcp-available-not-used`

### Stdin And Heredoc Contract

Track stdin and heredoc shape without persisting raw input by default.

```ts
interface CommandInput {
	stdinPresent: boolean;
	stdinBytes: number;
	stdinHash?: string;
	stdinRedactedShape?: string;
	heredocDetected: boolean;
	stdinPersisted: false;
}
```

Rules:

- Never store raw stdin by default.
- Redact stdin before parser use.
- Do not auto-rewrite stdin, pipeline, or heredoc commands unless the parser explicitly supports that input contract.
- Secret fixtures must include `cat .env | command`, `echo "$TOKEN" | command`, heredocs, and large stdin payloads.

### Adapter Output Budgets

Define adapter-specific response budgets before broad parser rollout.

```json
{
	"adapter": "codex",
	"maxReturnedBytes": 24000,
	"maxImportantItems": 25,
	"maxSearchMatches": 50,
	"maxSidecarPreviewBytes": 8000,
	"truncationPolicy": "critical-first"
}
```

Rules:

- Critical failures are surfaced before savings summaries.
- Truncation must say what was omitted and where to fetch the sidecar.
- Adapter-specific caps must be tested with huge stdout, huge stderr, huge single-line output, and many-file failure sets.

### Future Code Map Providers

`ctx_read` starts with conservative heuristics, but its design must allow stronger symbol providers later.

```ts
interface CodeMapProvider {
	name: "heuristic" | "tree-sitter" | "typescript-lsp" | "serena";
	supports(language: string): boolean;
	getSymbols(file: string): Promise<SymbolMap>;
	getReferences?(symbol: string): Promise<ReferenceMap>;
}
```

Provider order should be heuristic first, Tree-sitter next, compiler/LSP for supported languages, and optional Serena-compatible providers when available. Provider failure falls back to the next lower provider without blocking `ctx_read`.

### Additional Edge Fixtures

Add fixtures for CRLF, UTF-16, invalid UTF-8, non-English output, emojis, ANSI controls, binary-ish output, huge single-line minified files, and commands where exact output is the artifact and must not be compacted.

Binary handling rule: binary or binary-ish output is classify-only and sidecar-only by default. Do not summarize, decode, or compact binary output unless a parser explicitly declares binary support and has fixtures proving safe preview behavior.

Do-not-compact rule: commands where exact output is the requested artifact need golden fixtures proving the router returns pass-through or sidecar guidance instead of a lossy summary.

## Configuration Model

Add one versioned configuration model before auto-rewrite ships.

Precedence is split by category. A repository-controlled project config must not be able to weaken a user's security posture.

Emergency override precedence:

1. Per-call tool argument.
2. Environment variable.
3. User config.
4. Project config.
5. Built-in default.

Security merge rules:

- Most restrictive value wins for security, sidecar persistence, redaction, telemetry, fetch safety, path policy, deny rules, and auto-rewrite.
- Project config can tighten behavior by default.
- Project config cannot enable external telemetry, raw sidecars, weaker redaction, broader fetch/network access, weaker deny policy, or auto-rewrite if user config disables it.
- Security-weakening keys require user-level config or explicit interactive project trust.
- Emergency environment variables can only disable or narrow behavior unless explicitly documented otherwise.

UX merge rules:

- Per-call arguments win for that call.
- User config wins for personal defaults such as verbosity, preferred summaries, and dashboard display.
- Project config can suggest parser preferences and project-specific fixture paths when they do not weaken security.

Proposed files:

- Project: `.context-mode/config.json`
- User, Unix-like: `~/.config/context-mode/config.json`
- User, Windows: `%APPDATA%\\context-mode\\config.json`

Proposed schema:

```json
{
	"schemaVersion": 1,
	"router": {
		"mode": "recommend",
		"allowAutoRewrite": [
			"git status",
			"rg",
			"grep",
			"npm test",
			"pnpm test",
			"pytest"
		],
		"excludeCommands": [],
		"compoundCommands": "classify-only"
	},
	"read": {
		"mode": "recommend",
		"fullReadRequiresReason": true,
		"largeFileLines": 500,
		"repeatReadCollapse": true
	},
	"sidecar": {
		"mode": "failures",
		"maxRunBytes": 5242880,
		"maxProjectBytes": 104857600,
		"ttlDays": 14,
		"indexRawOutput": false
	},
	"analytics": {
		"local": true,
		"storeRedactedCommand": true,
		"storeFullCommand": false,
		"ttlDays": 30
	},
	"telemetry": {
		"enabled": false,
		"externalTelemetryAllowed": false
	},
	"security": {
		"redactBeforePersistence": true,
		"blockSensitiveSidecars": true,
		"stripAnsiControls": true
	},
	"adapters": {
		"codex": { "routerMode": "recommend" },
		"openclaw": { "routerMode": "recommend" }
	}
}
```

Required implementation details:

- Validate config with a runtime schema.
- Reject unknown `schemaVersion` with a clear error.
- Support migrations for future schema versions.
- Redact config values before diagnostics.
- Show effective config in `ctx doctor` without leaking secrets.
- List every security-sensitive key in the schema and test that project config cannot weaken it.
- Provide `ctx doctor --json` effective-config output with source labels and redacted values.
- External telemetry is out of scope for the first release. Future telemetry requires payload preview, endpoint allowlist, no stable install id by default, no paths or commands, retention policy, and separate tests.

## Threat Model

Assets to protect:

- Model context window.
- Local source files.
- Secrets in files, environment, command output, HTTP responses, logs, and sidecars.
- FTS content database.
- Session analytics database.
- Hook and adapter configuration files.

Trust boundaries:

- Agent request to context-mode tool.
- Hook input from client to context-mode router.
- Shell command output from untrusted projects.
- Web content fetched into the index.
- Project config loaded from a repository.
- Sidecar artifact retrieval.

Threats and required controls:

- Prompt injection in command output or web content.
  Strip or label untrusted instructions. Never execute instructions found in output.
- Malicious project config.
  Project config cannot weaken global security policy by default. Security downgrades require explicit user config.
- Symlink, path traversal, and case-folding attacks.
  Canonicalize paths, resolve symlinks, enforce project boundaries, and test Windows/macOS case behavior.
- Time-of-check/time-of-use path races.
  Re-check policy immediately before read, sidecar write, index refresh, and artifact retrieval.
- ANSI/control sequence injection.
  Strip terminal controls before chat, analytics, FTS, and sidecar preview.
- Secret leakage into FTS, sidecars, or analytics.
  Redact before persistence. Sensitive files are never cached or indexed.
- FTS poisoning.
  Mark indexed content with source, timestamp, trust level, and provenance. Search results from untrusted sources must be evidence-only records with `trusted=false`, escaped/render-safe text, capped snippets, and no instruction-like promotion.
- Parser omission.
  Low-confidence parsers must say so and preserve a sidecar pointer when policy allows.
- Command semantic changes.
  Auto-rewrite only allowlisted high-confidence commands. Compound commands are classify-only at first.
- Sidecar exfiltration.
  `ctx_fetch_run` must enforce path policy, project ownership, and slice/search defaults. Current stable lookup is scoped by `projectDir` plus `runId`/`latest`; it does not expose a session filter.
- Network rewrite abuse.
  Do not auto-rewrite `curl` or `wget` until URL safety exists. Future network rewrites must block `file://`, localhost, RFC1918, link-local, metadata endpoints, credentialed URLs, unsafe methods, custom auth headers, proxy env surprises, and unsafe redirects. Redirect targets must be revalidated.
- Path platform ambiguity.
  Use realpath-based boundary checks, case normalization, Windows drive/MSYS conversion rules, UNC/device path denial, alternate data stream denial, reserved-name handling, and opaque artifact ids instead of user-supplied artifact paths.
- Sidecar local disclosure.
  Store sidecars under project-scoped `.context-mode/runs` directories with restrictive permissions where the platform supports them. Use atomic create. Do not follow symlinks or hardlinks. Re-run redaction on retrieval. Include purge coverage.

Security test gates:

- Secret fixture suite must pass for chat output, FTS, sidecars, and analytics.
- Cross-platform path canonicalization tests must pass.
- Parser crash must not skip redaction.
- Untrusted output must not be rendered as trusted instructions.
- Fake `AGENTS.md`, system, tool, or developer instructions inside indexed content must be escaped and labeled as untrusted evidence.
- URL safety fixtures must cover redirects, private IPs, credentialed URLs, headers, proxy env, body limits, and network-disabled behavior before any network rewrite leaves recommendation mode.

## Data Contracts

Core entities must have stable ids and schema tests before implementation expands.

```ts
interface CommandSegment {
	id: string;
	parentRunId: string;
	index: number;
	dialect: "posix" | "powershell" | "cmd" | "unknown";
	rawShape: string;
	redactedShape: string;
	operatorsBefore: string[];
	operatorsAfter: string[];
	hasSideEffects: boolean;
	classificationOnly: boolean;
}

interface ParserResult {
	parserName: string;
	parserVersion: string;
	parserKind: string;
	confidence: {
		label: "high" | "medium" | "low";
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

interface RunArtifact {
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

interface AnalyticsEvent {
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
```

Rules:

- `artifactId`, not filesystem path, is the primary lookup key.
- Analytics stores `artifactId` and redacted display path, not raw local path.
- Full command text is not stored in analytics.
- Sidecar metadata stores only redacted command text by default.
- Storing full local command text requires explicit user config and must never feed external telemetry.
- FTS indexes summaries and safe metadata only, never raw sidecar content.
- Field-level FTS indexing must be documented and tested.
- `ctx_fetch_run --grep` searches redacted sidecar streams outside FTS by default.

FTS indexing contract:

- Indexed: summary, safe `important.message` text, file path only after path redaction, parser name/version, trust label, source label, timestamp, and artifact id.
- Not indexed: raw stdout, raw stderr, full command, local artifact path, environment values, HTTP bodies, sidecar content, unredacted paths, query strings, headers, cookies, and secret-like tokens.
- Every FTS row has `trusted`, `sourceKind`, `provenance`, `createdAt`, `expiresAt`, and `redactionVersion`.
- Expired sidecars must not leave live FTS rows that imply the artifact can still be fetched.
- Search snippets from untrusted rows must be escaped and labeled as evidence, not instructions.

## Rollout And Kill Switches

Feature flags:

- `CTX_MODE_ROUTER=off|recommend|rewrite`
- `CTX_MODE_READ=off|recommend|enforce`
- `CTX_MODE_SIDECAR=off|failures|always`
- `CTX_MODE_ANALYTICS=off|local`
- `CTX_MODE_RAW=1`

Adapter overrides:

- `CTX_MODE_CODEX_ROUTER=off|recommend|rewrite`
- `CTX_MODE_OPENCLAW_ROUTER=off|recommend|rewrite`
- Add matching overrides only when the adapter has tests.

Rollout stages:

1. `off`: code present, no routing.
2. `recommend`: classify and record decisions, no mutation.
3. `rewrite-canary`: rewrite one safe command per adapter.
4. `rewrite-allowlist`: rewrite only explicitly allowlisted command shapes.
5. `default-recommend`: recommendation mode enabled by default.
6. `default-rewrite`: only after benchmark, security, and adapter gates pass.

Rollback requirements:

- One environment variable disables all routing.
- `ctx doctor` reports effective router mode and source of the setting.
- `ctx_discover` reports whether bypasses came from disabled flags, missing hooks, or parser failures.
- Release notes include downgrade behavior for config schema changes.

## Benchmark Methodology

Add a reproducible benchmark suite before claiming savings.

Fixture corpus:

- Git status and diff outputs from small, medium, and large repos.
- `rg` and grep outputs with many repeated matches.
- Vitest, Jest, pytest, Go test JSON, ESLint JSON, TypeScript diagnostics.
- Docker logs with repeated lines and stack traces.
- `npm install` and package manager progress output.
- Large TypeScript, Markdown, JSON, YAML, and lock files for `ctx_read`.
- Secret-containing negative fixtures.

Measurements:

- Raw bytes and estimated raw tokens.
- Returned bytes and estimated returned tokens.
- Savings percent.
- Parser confidence and parse failure rate.
- False omission rate for known failures.
- Latency overhead p50 and p95.
- Sidecar disk usage.
- FTS growth.
- Adapter hook success rate.

Initial thresholds:

- Supported noisy commands: at least 80 percent returned-byte reduction.
- Parser crash rate: 0 in fixture suite.
- Known secret leaks: 0.
- False omission of known test/build failures: 0.
- Router latency overhead: under 50 ms p95 for classification-only paths.
- Sidecar retention respects configured project and global quotas.

Reproducibility requirements:

- Raw fixtures are committed or generated deterministically.
- Token estimator is fixed and versioned.
- Benchmarks emit `benchmark-report.json`.
- Adapter validation emits `adapter-validation-report.json`.
- MCP schema snapshots emit `schema-snapshot.json`.
- Parser fixtures emit `fixture-coverage.json`.
- Release candidates include `release-checklist.md`.
- CI fails if returned bytes regress by more than 10 percent for supported parsers.
- CI fails if known critical facts are omitted.
- CI fails if p95 classification latency exceeds the configured threshold.
- Shadow-mode rewrite must run before any auto-rewrite rollout with `0 unsafe rewrites`, at least `99 percent` golden route match, at least `99 percent` hook mutation success for a supported adapter, `0` known failure omissions, and rollback verification.

## Message Contract

Every router, parser, sidecar, config, and adapter failure must return a stable message shape.

Required fields:

- `code`: stable machine-readable code.
- `summary`: one-line human-readable result.
- `adapter`: adapter/client when known.
- `actionTaken`: `passed-through`, `blocked`, `downgraded`, `recommendation-only`, `sidecar-only`, or `raw-disabled`.
- `safetyImpact`: what was protected or what may be incomplete.
- `nextStep`: exact safe command or config change when available.
- `disableFlag`: relevant kill switch when applicable.
- `configSource`: redacted source of the effective setting.

Initial codes:

- `CTX_ADAPTER_NO_REWRITE`
- `CTX_CONFIG_SCHEMA_UNSUPPORTED`
- `CTX_ROUTER_PARSE_FAILED`
- `CTX_PARSER_LOW_CONFIDENCE`
- `CTX_REDACTION_FAILED`
- `CTX_SIDECAR_DISABLED`
- `CTX_ARTIFACT_NOT_FOUND`
- `CTX_FETCH_POLICY_BLOCKED`
- `CTX_PROJECT_CONFIG_UNTRUSTED`

Fail-open messages must never dump raw output by default. Fallback order is redaction, conservative compact summary, sidecar pointer if policy allows, and raw chat only behind explicit raw mode.

## Feature 1: Rewrite Registry

### Proposal

Add a central registry that maps raw commands or tool requests to context-mode routes.

Example behavior:

```text
git diff
  -> ctx_execute parser=git-diff command="git diff"

npm test
  -> ctx_execute parser=vitest-or-npm-test command="npm test"

rg "foo" src
  -> ctx_batch_execute or ctx_search style grouped result

cat src/App.tsx
  -> ctx_read mode=outline or ctx_execute_file summary

curl https://example.com
  -> recommendation only until network safety policy ships
```

Suggested files:

- `src/routing/rewrite-registry.ts`
- `src/routing/command-classifier.ts`
- `src/routing/routes.ts`
- `tests/router/rewrite-registry.test.ts`

Implementation note: this must be extracted shared routing, not a new independent router. Existing hook routing and server/tool recommendations should call the same classifier.

### Why

Context-mode currently depends heavily on agents following instructions. A registry makes routing machine-checkable and reusable across adapters, hooks, MCP guidance, and future CLI commands.

### Risks

- Incorrect rewrites can change command behavior.
- Compound commands can contain stateful or destructive segments.
- Windows quoting and PowerShell syntax can be misclassified.
- Agents may need raw behavior for debugging.

### Mitigations

- Default to recommendation mode first: return "recommended route" without mutation.
- Only auto-rewrite allowlisted command shapes.
- Split compound commands into independent segments before classification.
- Preserve only redacted command shape and salted command hash in analytics.
- Store full command text only in local sidecar metadata when explicit user config permits it.
- Add explicit `--raw`, `--full`, and `CTX_MODE_RAW=1` bypasses.
- Keep network commands recommendation-only until URL safety policy and SSRF fixtures pass.

### Test Plan

- Unit tests for command classification: git, npm, pnpm, npx, rg, grep, cat, type, Get-Content, curl, wget, pytest, vitest, docker logs.
- Windows quoting tests for PowerShell paths, spaces, and drive letters.
- Compound command tests for `&&`, `||`, `;`, pipes, subshells, and redirections.
- Golden tests: raw command input -> route decision JSON.
- Safety tests proving destructive commands are never rewritten into hidden execution.

## Feature 2: Parser And Filter Plugin Taxonomy

### Proposal

Create parser/filter modules with one consistent result shape.

Suggested shape:

```ts
interface FilterResult {
	status: "passed" | "failed" | "partial" | "unknown";
	summary: string;
	parser: {
		name: string;
		version: string;
		confidenceLabel: "high" | "medium" | "low";
		confidenceScore: number;
		confidenceReasons: string[];
		parseFailure: boolean;
	};
	process: {
		exitCode: number | null;
		stdoutBytes: number;
		stderrBytes: number;
		unparsedBytes: number;
		truncated: boolean;
	};
	redaction: {
		version: string;
		counts: Record<string, number>;
	};
	important: Array<{
		file?: string;
		line?: number;
		message: string;
		kind?: string;
		severity: "critical" | "error" | "warning" | "info";
		mustSurface: boolean;
	}>;
	omitted: Record<string, unknown>;
	artifacts?: Array<{
		label: string;
		path: string;
		kind: "raw-output" | "json" | "log" | "report";
	}>;
	savings: {
		rawBytes: number;
		returnedBytes: number;
		rawTokensEstimate: number;
		returnedTokensEstimate: number;
		savedPercent: number;
	};
}
```

Must-surface categories:

- Nonzero exit.
- Timeout.
- stderr warning or error.
- Security advisory or vulnerability.
- Auth failure.
- Permission error.
- Policy denial.
- Skipped tests.
- No tests found.
- Flaky retry.
- Package peer conflict.
- Lifecycle install script.
- Compile diagnostic.
- Parser truncation.
- Redaction notice.
- Destructive operation warning.

Suggested taxonomy:

- `failure-focus`: test runners, builds, linters.
- `grouping`: search results, file lists, git status.
- `dedupe`: logs, repeated stack frames, install output.
- `tree-compression`: directory trees and dependency graphs.
- `json-structure`: JSON files and command JSON output.
- `ndjson-stream`: Go tests, structured log streams.
- `state-machine`: progress bars, test runner streams, Docker logs.
- `code-map`: imports, exports, symbols, top-level structure.
- `secret-redaction`: tokens, cookies, auth headers, `.env`-like content.

Suggested files:

- `src/filters/types.ts`
- `src/filters/registry.ts`
- `src/filters/git-diff.ts`
- `src/filters/git-status.ts`
- `src/filters/rg.ts`
- `src/filters/vitest.ts`
- `src/filters/pytest.ts`
- `src/filters/eslint.ts`
- `src/filters/docker-logs.ts`
- `tests/filters/*.test.ts`

### Why

RTK's strongest practical idea is not one specific filter; it is the reusable taxonomy. Context-mode needs parser modules that can be composed by `ctx_execute`, hooks, and future `ctx_read` without duplicating heuristics inside `src/server.ts`.

### Risks

- Parser drift as upstream tools change output.
- Over-aggressive filtering can hide a root cause.
- Plugin boundaries can become too abstract before enough parsers exist.
- Secret redaction bugs can leak into sidecars or FTS.

### Mitigations

- Store parser version in every artifact and analytics event.
- Always include raw sidecar pointer for failure cases unless blocked by policy.
- Keep first parser set small: git status, git diff, rg, vitest, pytest, npm install.
- Redact before writing any sidecar or index entry.
- Add parse confidence: `high`, `medium`, `low`. Low confidence returns conservative summaries.
- Add numeric confidence score from 0 to 1 plus reason codes.
- Rewrite eligibility requires high confidence, parser-specific fixture gate, and allowlisted command shape.
- Low-confidence output must include unparsed-byte counts, a visible incomplete-summary notice, and a sidecar pointer when policy allows.

### Test Plan

- Fixture-based parser tests with real captured outputs.
- Golden output snapshots for each parser.
- Fuzz tests for malformed JSON, partial lines, truncated logs, ANSI color, and binary-ish output.
- Secret redaction tests run before parser-specific assertions.
- Mutation tests: parser exception must fall back without crashing the MCP tool.

### Ship Gate

A parser starts as `experimental` and cannot become rewrite-eligible until it meets this gate:

- Parser-specific fixture matrix covering OS, success, failure, malformed output, truncated output, ANSI, interleaved stdout/stderr, old and new tool versions, huge output, secrets, empty/no-match output, and localized output where relevant.
- Golden snapshots for success, failure, empty output, malformed output, and truncated output.
- Known failures are never omitted from `important`.
- Parser-specific must-preserve signals are never omitted: vulnerabilities, secrets, auth failures, permission errors, destructive operations, install scripts, policy denials, warnings, and critical diagnostics.
- Redaction runs before parser output, sidecar write, FTS indexing, and analytics persistence.
- Parser confidence is calibrated against fixtures.
- Parser failure returns a conservative summary and records `parseFailure=true`.
- Raw sidecar pointer is available for failed or low-confidence parses when policy allows.
- Benchmark suite shows net context savings after parser overhead.
- Security review completed for parsers that handle secrets, logs, HTTP, package installs, or raw sidecars.
- Critical fact oracle fixtures define expected surfaced facts, expected omitted counts, forbidden omissions, false failure rate, and parser downgrade cases.

## Feature 3: Raw Output Sidecar

### Proposal

When command output is large, failed, or parser confidence is low, write redacted raw output to a local run artifact and return a compact pointer.

Default sidecars are redacted raw output, not lossless unredacted output. Unredacted retention is out of scope for the first release; if added later, it must be encrypted opt-in user config only.

Example response:

```text
FAILED npm test
2 failed, 183 passed

Failures:
- src/parser.test.ts:42 expected "active", got "pending"
- src/client.test.ts:91 timeout after 5000ms

Full redacted output:
.context-mode/runs/2026-05-17T1112Z/npm-test/raw.log
```

Suggested files:

- `src/artifacts/run-store.ts`
- `src/artifacts/redaction.ts`
- `src/tools/fetch-run.ts`
- `tests/artifacts/run-store.test.ts`

Storage policy:

- Store artifacts under the existing context-mode session/content area by default, not inside source trees.
- Optionally mirror project-relative pointers for readability.
- Never index raw sidecar content into FTS unless a future explicit safe-index mode is added.
- Store metadata separately from raw content: command category, cwd, timestamp, exit code, parser, confidence, content hash, redaction version, and owning session id.
- Project identity metadata must include git root, package root when detectable, branch, HEAD commit, and a remote URL hash. Never store full remote URLs by default.
- Enforce both per-run and per-project byte limits.
- Cleanup runs on session start, `ctx doctor`, and artifact write.
- Moving a project should not make old sidecars look current; stale project identity must be shown.
- Use per-user private directories and restrictive permissions.
- Write artifacts atomically.
- Do not follow symlinks or hardlinks when writing or reading artifacts.
- Store a redaction manifest: redaction version, rule ids, replacement counts, and whether secrets were removed.
- Re-run redaction on retrieval before returning any sidecar slice.
- Cover sidecars in `ctx purge` for project and session scopes, including SQLite/WAL side effects where relevant.
- Capture sidecars from executor streams before large stdout/stderr buffers are built or byte-capped output is lost.

### Why

Agents often rerun noisy commands because summaries omit one detail. Sidecars let the model ask for targeted slices instead of re-executing and flooding context.

### Risks

- Sensitive data can be cached.
- Artifact growth can consume disk.
- Pointers can break after project moves.
- Raw output can become stale relative to current files.

### Mitigations

- Redact before writing.
- Never sidecar known sensitive files: `.env`, keys, tokens, cookies, auth headers, SSH material.
- Use project-relative paths plus metadata with original cwd, command, timestamp, hash, exit code, parser.
- Add TTL and max-size cleanup.
- Add `ctx_fetch_run --list`, `--latest`, `--pin`, `--raw`, `--slice`, `--grep`, and `--json` instead of dumping full raw logs.
- Enforce session/project ownership before artifact retrieval.
- Return slices or search hits by default; full raw retrieval requires explicit `raw=true`.
- Strip ANSI/control sequences before previews.
- `ctx_fetch_run --grep` defaults to fixed-string search. Regex is opt-in with max pattern length, timeout, binary detection, max returned matches, and redacted-stream-only guarantee.
- Pinned artifacts are exempt from TTL cleanup but still count against hard project caps and remain covered by explicit purge.

### Test Plan

- Sidecar creation tests for failed tests, large stdout, and parser failure.
- Redaction tests for env vars, bearer tokens, cookies, private keys, GitHub tokens, AWS keys.
- Retention tests for TTL and max disk budget.
- Staleness tests showing command hash, cwd, and timestamp in metadata.
- `ctx_fetch_run` tests that slices output without returning whole logs by default.
- Ownership tests: cannot fetch artifacts outside the current project/session scope.
- Stale project tests after cwd or project identity changes.
- Cleanup trigger tests for session start, doctor, and write-time pruning.
- Atomic write and restrictive permission tests.
- Symlink/hardlink refusal tests.
- Re-redaction-on-retrieval tests.
- List/latest/pin tests proving useful artifacts can be found without rerunning the command.

## Feature 4: `ctx_read` Modes

### Proposal

Add a first-class read tool that treats files as code or data, not terminal text.

`ctx_read` is a facade over existing file policy and sandboxed file-processing behavior. It must not bypass `ctx_execute_file` path-deny checks or create a second raw-read pathway.

Modes:

- `map`: imports, exports, top-level symbols, rough line ranges.
- `outline`: file map plus short summaries of major sections.
- `symbols`: exported symbols and public signatures.
- `slice`: exact line range for direct edit context.
- `search`: pattern matches with small context.
- `full`: complete file, requires reason and policy check.

Default behavior:

- Small file: full return allowed.
- Medium file: outline plus suggested slices.
- Large file: map, exports, imports, and suggested line ranges.
- Repeated unchanged read: return hash and "unchanged since last read".
- Direct edit target: allow full read once per phase with reason.

Suggested files:

- `src/tools/read.ts`
- `src/read/file-classifier.ts`
- `src/read/code-map.ts`
- `src/read/read-cache.ts`
- `tests/read/*.test.ts`

### Why

The main context-mode pain point is file-read flooding. RTK mostly compresses command output; context-mode needs to prevent oversized file reads and repeated unchanged reads.

### Risks

- Incomplete maps can mislead edits.
- Language parsing can be hard across TypeScript, Python, Markdown, JSON, YAML, logs.
- Too much friction can slow legitimate edits.
- Hash caching can hide changes from generated files or external tools.

### Mitigations

- Start with language-agnostic heuristics plus TypeScript-aware parsing later.
- Always expose suggested slices.
- Allow explicit `full` with reason, audited in analytics.
- Hash file content on each request, not just mtime.
- Use deny policy before reading or indexing.

### Test Plan

- File size threshold tests.
- TypeScript fixture tests for imports, exports, functions, classes, interfaces.
- Markdown/JSON/YAML/log behavior tests.
- Repeated read tests: unchanged, changed hash, deleted file.
- Policy tests for denied paths and sensitive files.
- Adapter prompt tests proving clients prefer `ctx_read` for analysis.

## Feature 5: JSON-First Execution

### Proposal

Teach rewrite rules and parsers to prefer structured output when a command supports it.

Examples:

- `eslint` -> JSON formatter.
- `tsc` -> parse diagnostics directly, or use structured problem matcher if available.
- `vitest` -> reporter JSON when stable, fallback to text parser.
- `go test` -> `-json`.
- `npm audit` -> `--json`.
- `docker inspect` -> JSON.
- `git status` -> porcelain v2.

### Why

Text parsing is brittle. Structured output makes compact summaries more accurate, easier to test, and safer to redact.

### Risks

- JSON modes can change command semantics or disable familiar output.
- Some tools produce invalid JSON on mixed stdout/stderr.
- Large JSON can still flood context if returned directly.
- User commands may include flags that conflict with forced JSON flags.

### Mitigations

- Registry marks structured-output rewrites as `safe`, `conditional`, or `manual`.
- Preserve user-provided flags unless conflict rules are explicit.
- Parse JSON inside sandbox and return only the summary.
- On malformed JSON, fall back to text parser and record parse failure.
- Capture stdout and stderr as separate streams.
- JSON parsing must not hide stderr warnings or errors.
- NDJSON parsers must handle partial final lines, malformed records, and interleaved stderr.
- Structured parsers must surface parser truncation, malformed trailing JSON, and unparsed-byte counts.
- User-specified reporter/formatter flags override automatic structured-output flags unless the registry marks the rewrite as safe.

### Test Plan

- Per-command rewrite tests for structured flags.
- Conflict tests: user already passed reporter/format flags.
- Malformed JSON fixtures.
- Mixed stdout/stderr fixtures.
- Savings tests comparing raw JSON size to returned summary size.

## Feature 6: `ctx_gain` And Analytics Upgrade

### Proposal

Extend current stats/analytics into an explicit savings and quality surface.

Commands:

- `ctx_gain`: current session savings summary.
- `ctx_gain --history`: recent runs.
- `ctx_gain --daily`: daily rollup.
- `ctx_gain --json`: dashboard export.
- `ctx_gain --by-tool`: savings by parser, tool, adapter, and client.

Track through existing session DB and `AnalyticsEngine` event flows:

- Raw bytes and returned bytes.
- Estimated raw tokens and returned tokens.
- Parser used and parser confidence.
- Parse failures.
- Bypass reason.
- Sidecar `artifactId` and redacted display path if present.
- Adapter/client.
- Command category.

### Why

Context-mode already tracks bytes, tool calls, and savings. RTK-style gain views make the value visible and make weak filters obvious.

### Risks

- Token estimates can be inaccurate.
- Analytics schema migrations can break existing sessions.
- Storing commands can leak sensitive arguments.
- Too much detail can slow hot paths.

### Mitigations

- Store full command only in local sidecar metadata when explicit user config permits it.
- Store anonymized command category, redacted argv shape, and salted command hash for aggregate dashboards.
- Keep analytics writes best-effort and off hot path.
- Version schemas and migration code.
- Label estimates clearly as estimates.
- Separate local analytics from any future external telemetry.
- External telemetry remains disabled by default and opt-in only.
- Persist exact field names in a schema test so new fields get privacy review.

### Privacy Model

Local analytics may store:

- Tool name.
- Adapter name.
- Parser name and version.
- Command category.
- Redacted argv shape.
- Salted command hash.
- Raw and returned byte counts.
- Estimated token counts.
- Parser confidence.
- Parse failure flag.
- Sidecar `artifactId`.
- Redacted sidecar display path.

Local analytics must not store by default:

- Full command arguments.
- Environment variable values.
- Raw stdout or stderr.
- HTTP bodies.
- Secret-looking path segments or query strings.
- File contents.

Any external telemetry must be a separate opt-in feature with its own schema, retention policy, and `ctx doctor` visibility.

Analytics retention:

- Local analytics has configurable TTL.
- `ctx purge` must delete session/project analytics, FTS rows, sidecars, and SQLite/WAL side effects for the selected scope.
- `ctx doctor` reports retained analytics bytes, oldest record, and sidecar bytes.
- External telemetry is not shipped in the first release.

### Test Plan

- Session DB migration tests.
- Analytics aggregation tests with fixture sessions.
- Redaction tests for persisted command metadata.
- Performance tests proving tracking overhead stays below target.
- Dashboard/export tests for stable JSON shape.
- Privacy snapshot tests proving only approved fields persist.
- Purge tests for FTS, analytics, sidecars, and WAL files.

## Feature 7: `ctx_discover` Missed-Savings Scanner

### Proposal

Add a scanner that reports bypasses and improvement opportunities.

Example output:

```text
Top missed savings, last 7 days:
1. Read src/pages/Backtest.tsx       84k estimated tokens, repeated 6x
2. Bash npm test                     41k estimated tokens, raw output
3. grep "useStrategy" src           18k estimated tokens, ungrouped
4. cat package-lock.json             52k estimated tokens, should block
```

Commands:

- `ctx_discover --session latest`
- `ctx_discover --last 7d`
- `ctx_discover --adapter codex`
- `ctx_discover --json`

Each item must include:

- `cause`
- `confidence`
- `adapterTier`
- `adapterCoverage`
- `recommendedConfigPatch`
- `manualInstructionPatch`
- `safeToAutoFix`
- `unknownCoverage` when the adapter lacks pre/post hook visibility

### Why

This is the feedback loop that makes context-mode improve itself. It shows which instructions failed, which hooks did not fire, and where new rewrite rules or parsers are worth building.

### Risks

- False positives can create noisy recommendations.
- Estimating raw output for blocked or bypassed tools can be hard.
- Adapter event schemas may differ.
- Discover can expose sensitive command arguments.

### Mitigations

- Rank by estimated savings and confidence.
- Include "why detected" and "recommended fix" for every item.
- Redact and bucket commands before display.
- Treat unknown adapter event shapes as low-confidence.
- Report adapter-capability limits instead of pretending every missed route was observable.

### Test Plan

- Fixture sessions with raw reads, repeated reads, Bash floods, direct web fetches, grep floods.
- Cross-adapter tests for Codex, Claude, OpenClaw, Cursor.
- Redaction tests for displayed command names and paths.
- Ranking tests for top missed savings.

## Feature 8: Fail-Open Hook And Parser Design

### Proposal

Formalize hook failure behavior:

- Router/parser crash after redaction: allow original action or return clear fallback guidance.
- Security policy denial: block when hook is the enforcement point.
- Secret cache/index denial: fail closed and do not persist.
- Analytics write failure: ignore and continue.
- Redaction failure: fail closed for persistence and downgrade to no-persist conservative output.
- Path, sidecar, FTS, telemetry, and fetch safety uncertainty: fail closed for that capability.

Pipeline order:

```text
capture/quarantine
  -> security and path policy
  -> redaction
  -> parser/filter
  -> sidecar and analytics persistence
  -> response formatting
```

Every hook should return a valid client response and avoid breaking the agent loop because context-mode internals failed.

### Why

Agents should not lose ability to work because a filter crashes. Context-mode is an output firewall, not a fragile command gate. Security enforcement is the exception.

### Risks

- Fail-open can allow noisy output if parser crashes.
- Fail-open can mask parser regressions.
- Different clients use different hook semantics.

### Mitigations

- Emit parse-failure analytics.
- Show concise `CTX_*` message-contract notices when appropriate.
- Add adapter-level contract tests.
- Keep security decisions separate from compression decisions.
- Fail open only for optimization failures after redaction succeeds.

### Test Plan

- Forced parser exception tests.
- Forced analytics DB failure tests.
- Hook process crash simulation.
- Adapter contract tests for exit code and returned payload.
- Security denial tests proving fail-open is not used for secret/path policy.

## Feature 9: Verbosity And Raw Escape Hatches

### Proposal

Support consistent verbosity controls across tools and hooks.

Levels:

- `compact`: default summary.
- `normal`: summary plus key context.
- `verbose`: more grouped details.
- `raw-pointer`: summary plus sidecar pointer.
- `raw`: full output only when explicitly requested and allowed by policy.

Inputs:

- Tool params: `verbosity`, `raw`, `full`.
- CLI/env: `CTX_MODE_VERBOSITY`, `CTX_MODE_RAW`.
- Command flags: `--raw`, `--full`, `-vvv` when context-mode owns the wrapper command.

### Why

Compaction must be reversible enough for debugging. Without a sanctioned raw path, agents rerun commands or bypass context-mode entirely.

### Risks

- Raw mode can reintroduce context floods.
- Flags can conflict with wrapped command flags.
- Users may normalize raw mode and lose savings.

### Mitigations

- Raw mode requires explicit reason for large output.
- Raw output still runs through redaction and deny policy.
- Raw mode returns slices by default when sidecar exists.
- Analytics records raw usage.

### Test Plan

- Verbosity matrix tests for representative filters.
- Raw request tests for sidecar retrieval.
- Large output guard tests.
- Redaction tests for raw mode.

## Feature 10: Integration Tiers

### Proposal

Document and implement three integration tiers.

Tier 1: Hook rewrite

- Before-tool hooks classify and rewrite raw tool calls.
- Requires pre-tool hook support and proven input mutation support.
- Highest savings.

Tier 2: MCP tool guidance

- Agent sees `ctx_*` tools and descriptions.
- Tool descriptions contain routing rules.
- Good for clients with no mutation hook.

Tier 3: Rules-file fallback

- `AGENTS.md`, `CLAUDE.md`, client-specific plugin config, or OpenClaw install snippets.
- Required for clients that cannot hook or mutate commands.

Suggested additions:

- `docs/integration-tiers.md`
- Adapter-specific capability matrix in `docs/platform-support.md`.
- `ctx doctor` checks for tier installed, active, and recently used.

Initial adapter capability matrix:

| Adapter           | Observe        | Deny           | Input Rewrite  | Output Rewrite | Tier 2 MCP | Tier 3 Rules | Initial Status | Notes                                                                                |
| ----------------- | -------------- | -------------- | -------------- | -------------- | ---------- | ------------ | -------------- | ------------------------------------------------------------------------------------ |
| Codex             | Yes            | Partial        | No             | No             | Yes        | Yes          | Tier 2/3       | Current hooks cannot mutate input; do not mark tier 1 until upstream support exists. |
| Claude Code       | Yes            | Yes            | Probe Required | Probe Required | Yes        | Yes          | Candidate      | Must pass mutation contract tests.                                                   |
| OpenClaw          | Yes            | Probe Required | Probe Required | Probe Required | Yes        | Yes          | Candidate      | Must validate workspace and nested Codex home installs.                              |
| Cursor            | Probe Required | Probe Required | Probe Required | Probe Required | Yes        | Yes          | Probe Required | Closed-source/tool-name matcher uncertainty requires real session fixtures.          |
| OpenCode          | Probe Required | Probe Required | Probe Required | Probe Required | Yes        | Yes          | Probe Required | Prefer explicit plugin smoke tests before rewrite.                                   |
| Pi                | Unknown        | Unknown        | No             | No             | Yes        | Yes          | Tier 2/3       | Treat as MCP/rules first until hook mutation is proven.                              |
| Gemini CLI        | Probe Required | Probe Required | Probe Required | Probe Required | Yes        | Yes          | Probe Required | Requires formatter and hook contract tests.                                          |
| Kiro              | Yes            | Partial        | No             | Unknown        | Yes        | Yes          | Tier 2/3       | Do not mark tier 1 while adapter capabilities report no arg mutation.                |
| Qwen Code         | Unknown        | Unknown        | Unknown        | Unknown        | Yes        | Yes          | Tier 2/3       | Treat as guidance-only until mutation support is proven.                             |
| Zed               | Unknown        | Unknown        | No             | No             | Yes        | Yes          | Tier 2/3       | Rules fallback first.                                                                |
| JetBrains Copilot | Probe Required | Probe Required | Probe Required | Probe Required | Yes        | Yes          | Probe Required | Requires platform-specific install and hook tests.                                   |
| Antigravity       | No             | No             | No             | No             | Yes        | Yes          | Tier 2/3       | MCP-only unless adapter capability changes.                                          |
| VS Code Copilot   | Probe Required | Probe Required | Probe Required | Probe Required | Yes        | Yes          | Probe Required | Add contract tests before any rewrite claims.                                        |
| OMP               | Unknown        | Unknown        | No             | No             | Yes        | Yes          | Tier 2/3       | Treat as guidance/MCP first.                                                         |

Matrix rules:

- `Candidate` means code paths or hook files appear to exist, not that auto-rewrite is approved.
- `Probe Required` means docs or code are insufficient; real hook-event fixtures are required.
- Tier 1 requires `preToolUse && canModifyArgs` or equivalent capability.
- Tier 1 becomes `Supported` only after an adapter contract test proves input mutation, fail-open behavior, kill switch, dry-run mutation snapshots, unsupported-client negative tests, idempotent install/uninstall, and rollback flags.
- `ctx doctor` must report actual installed tier, not the theoretical maximum.
- `ctx_discover` must report when the current adapter is operating below its supported tier.
- The matrix should be generated from or validated against adapter capability objects.

Adapter contract contents:

- Golden hook-event fixtures.
- Dry-run mutation snapshots.
- Kill-switch tests.
- Unsupported-client negative tests.
- Nested-home install tests where applicable.
- Idempotent install and uninstall tests.
- Live smoke for one safe command before tier 1 support.
- `ctx hook test --adapter <name>` fixture proving a harmless command was observed, classified, and either recommended or rewritten according to adapter capability.
- Failed-command behavior tests for clients that do not emit post-hook events on failure.

Windows compatibility matrix:

| Environment         | Required Coverage                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Native PowerShell   | Quoting, spaces in paths, `%APPDATA%`, drive letters, execution policy, and no Bash-only installer assumptions.  |
| Git Bash/MSYS       | Windows drive conversion, slash normalization, quoted spaces, and mixed shell command parsing.                   |
| WSL                 | Linux paths, Windows-mounted repo paths, interop command behavior, and separate home/config directories.         |
| OpenClaw on Windows | Workspace path, nested Codex home, `CODEX_HOME`, and install guidance when native script support is unavailable. |
| CI Windows runner   | Config loading, path policy, sidecar permissions, artifact cleanup, and `ctx doctor --json`.                     |

### Why

RTK explicitly handles different integration levels. Context-mode supports many adapters, so feature design must say where enforcement actually happens.

### Risks

- Users can think they are protected by tier 1 when only tier 3 is installed.
- Multiple configs can conflict.
- OpenClaw/Codex home split can install guidance in one location but not the active one.

### Mitigations

- `ctx doctor` reports active tier per adapter.
- `ctx_discover` reports "bypassed because no hook event observed".
- Installer writes to all known active homes only with confirmation.
- Add adapter-specific smoke tests.
- Add `ctx doctor --adapter <name> --json` and `--repair-plan`.
- Doctor output includes last hook event seen, active config path, expected install paths, stale duplicate installs, and exact next command.

### Test Plan

- Installer tests for Codex, OpenClaw, Claude Code, Cursor, OpenCode.
- Doctor tests for missing, partial, stale, and duplicate installs.
- Hook smoke tests that observe one known rewritable command.
- OpenClaw multi-home tests for workspace and agent Codex home paths.
- Adapter matrix tests that keep docs and detected capabilities in sync.

## Feature 11: Command Segment Handling

### Proposal

Add a parser that splits shell command strings into safe segments before routing.

Initial segmentation builds an AST for classification only. Execution remains the original command unless dialect, operators, environment assignments, cwd changes, redirection, and side effects are proven safe.

Handle:

- `&&`
- `||`
- `;`
- pipes
- redirection
- subshells
- PowerShell pipelines
- cmd.exe syntax
- Git Bash/MSYS syntax
- env assignments
- heredocs
- subshells and command substitution
- quoted strings
- quoted operators
- escaped spaces
- Windows drive letters

Classify each segment independently for recommendations and analytics:

```text
git status && npm test
  -> segment 1: git-status parser
  -> segment 2: test parser

rg foo src | head
  -> segment 1: rg parser
  -> segment 2: passthrough modifier, preserve top-N intent
```

### Why

One unrouted compound command can dump large output. Context-mode needs segment-level routing to avoid all-or-nothing behavior.

### Risks

- Shell parsing is hard and platform-specific.
- Reordering or splitting can change side effects.
- Pipes and redirections can be semantically meaningful.

### Mitigations

- Initial version only classifies, does not execute split segments.
- Auto-rewrite only for simple allowlisted commands.
- Mark commands with redirection/subshell as manual review.
- Preserve original command execution path unless confidence is high.
- Treat pipes, redirects, heredocs, env assignments, cwd changes, and subshells as no-rewrite unless a parser-specific proof exists.
- Dialect detection must be explicit: POSIX shell, PowerShell, cmd.exe, Git Bash/MSYS, or unknown.

### Test Plan

- Shell grammar fixture tests.
- PowerShell fixture tests.
- "Do not rewrite" tests for ambiguous commands.
- Equivalence tests for simple command chains.

## Feature 12: Safety Model

### Proposal

Codify safety rules for router, filters, sidecars, and analytics.

Rules:

- No direct shell string execution when argv execution is available.
- Canonicalize paths.
- Block path traversal.
- Apply deny policy before read, write, index, or sidecar storage.
- Redact secrets before output, index, sidecar, analytics, or telemetry.
- Never cache `.env`, private keys, tokens, auth headers, cookies, or SSH material.
- Keep telemetry disabled by default and explicit opt-in only.
- Treat parser/filter changes as security-sensitive when they touch redaction, caching, or command execution.
- Apply the threat model above to every new parser, router rule, sidecar path, and adapter mutation path.
- Strip terminal controls before rendering or persisting output.
- Label untrusted indexed content so search results cannot masquerade as trusted instructions.

### Why

Context-mode executes commands and stores searchable content. The output firewall becomes a liability if it caches secrets or hides dangerous command behavior.

### Risks

- Secret patterns are never complete.
- Redaction can corrupt useful diagnostics.
- Canonical path behavior differs across Windows, WSL, macOS, and Linux.
- Analytics can accidentally store full sensitive commands.

### Mitigations

- Maintain high-risk file denylist.
- Redact before all persistence.
- Store command prefix/category separately from full local command.
- Add platform-specific path tests.
- Security review checklist required for filters that persist raw content.

### Test Plan

- Cross-platform path canonicalization tests.
- Secret fixture suite.
- Analytics persistence redaction tests.
- Sidecar redaction tests.
- Deny-policy tests for read, index, fetch, execute, and retrieve-run paths.
- Prompt-injection fixture tests for command output and fetched web content.
- ANSI/control sequence stripping tests.
- Symlink and path-race tests where the platform supports them.

## Feature 13: Semantic Diff And Risk Summary

### Proposal

Add a semantic diff surface inspired by Difftastic, but keep raw Git diff as the source of truth.

Commands:

- `ctx_diff --semantic`
- `ctx_diff --semantic --summary`
- `ctx_diff --risk`
- `ctx_diff --raw-sidecar`

Expected behavior:

- Prefer a syntax-aware provider when available.
- Fall back to existing `git-diff` parsing when the language, file type, or binary is unsupported.
- Preserve file-level change inventory from raw Git diff.
- Return semantic change groups, moved/renamed logic, public API changes, test impact hints, and generated/lockfile warnings.
- Store raw diff output as a sidecar when the compact response omits hunks.
- Never hide deleted files, binary changes, submodule changes, permission changes, or conflict markers.

### Why

Line diffs are noisy after formatting, import sorting, generated bundle churn, or large refactors. A semantic summary helps agents answer "what actually changed?" without flooding context with a full patch.

### Risks

- Syntax-aware diff can be wrong or incomplete for unsupported languages.
- External diff tools can add install and platform friction.
- Generated files and lockfiles often need textual inspection, not semantic grouping.
- Risk scoring can become speculative and overconfident.

### Mitigations

- Provider interface first: `git-text`, `difftastic`, future tree-sitter diff.
- Raw diff inventory is always included even when semantic provider succeeds.
- Risk labels must include reason codes and confidence.
- Generated, binary, lockfile, minified, and vendored files default to textual summary plus raw sidecar pointer.
- Provider failure fails open to `git-diff` parser output.

### Test Plan

- Fixtures for formatting-only changes, moved functions, renamed symbols, generated bundle churn, lockfile changes, binary changes, deleted files, and parse failures.
- Golden tests proving raw file inventory matches `git diff --name-status`.
- Provider-failure test proving fallback to text diff.
- Risk-summary tests requiring reason codes and confidence.
- Sidecar tests proving omitted hunks remain retrievable.

## Feature 14: Local Trace Observability

### Proposal

Extend `ctx_gain` analytics into a local trace model. This is observability for agent behavior, not external telemetry by default.

Commands:

- `ctx_trace --latest`
- `ctx_trace --session <id>`
- `ctx_trace --why-big`
- `ctx_trace --tool-breakdown`
- `ctx_trace --json`

Trace spans:

- Agent/session/task span.
- Tool call span.
- Router decision span.
- Parser/filter span.
- Sidecar write/read span.
- Guard scan span.
- Cache lookup/run span.
- Bypass classification span.

Core fields:

- Session id, adapter id, agent id when available.
- Tool name and command category.
- Raw bytes, returned bytes, estimated tokens, and savings.
- Parser name, parser version, confidence, and failure reason.
- Sidecar artifact id and redacted path.
- Route decision, selected rule, rejected rules, and safety reason.
- Bypass category and adapter capability.
- Latency, exit code, and fail-open/fail-closed marker.

OpenTelemetry alignment:

- Local schema should map cleanly to OpenTelemetry spans and GenAI semantic-convention-style token fields.
- External export is out of scope for first trace release.
- Any future OTLP export must be opt-in, endpoint-allowlisted, redacted, and visible in `ctx doctor`.

### Why

Byte savings alone does not explain agent behavior. Trace views should answer why a task was large, whether Graphify or Serena was used first, which parser failed, which tool bypassed context-mode, and which adapter ignored a routing recommendation.

### Risks

- Traces can accidentally store sensitive command text, paths, or output.
- Trace writes can slow hot paths.
- OpenTelemetry field churn can cause schema drift.
- A trace UI can imply precision that estimated token counts do not have.

### Mitigations

- Store redacted argv shape, command category, salted command hash, and approved metadata only.
- Use best-effort writes with short busy timeouts.
- Version the local trace schema separately from any OTel mapping.
- Keep external telemetry disabled by default.
- Label token counts as estimates unless a provider reports exact usage.

### Test Plan

- Trace fixture sessions for large task, parser failure, native tool bypass, MCP available but unused, and hook present no mutation.
- Privacy snapshot tests for persisted trace fields.
- OTel mapping contract test that runs locally without sending data.
- Fail-open tests where trace DB is locked or unavailable.
- `ctx_trace --why-big` golden output tests.

## Feature 15: Deterministic Task Cache

### Proposal

Add a cache for repeat side-effect-free command results, borrowing input-fingerprint ideas from Nx, Turborepo, and Bazel.

Commands:

- `ctx_run_cached -- <command>`
- `ctx_cache explain -- <command>`
- `ctx_cache list`
- `ctx_cache purge [--dry-run]`

Cache key inputs:

- Normalized command argv and command category.
- Cwd, package root, git root, branch, and commit when available.
- Relevant source files and fixture files.
- Lockfiles and package/tool config files.
- Redacted environment shape plus approved non-secret environment values declared by the command-family manifest.
- Runtime versions for Node, Python, Go, Rust, Java, and tool binaries when relevant.
- Parser version and context-mode version.

Candidate command families, gated by per-family manifest approval:

- `tsc --noEmit`
- `eslint`
- `vitest run`
- `pytest`
- `go test`
- selected read-only `git status` and `git diff` summaries when the key includes index and working-tree state.

Only `tsc --noEmit` is eligible for the first cache-hit serving canary. The rest remain explain-only until their manifests and eval fixtures prove deterministic behavior.

Never cache by default:

- Install commands.
- Database migrations.
- Deploy or publish scripts.
- Dev servers.
- Watch mode.
- Interactive commands.
- Commands that read stdin unless the parser explicitly supports a redacted stdin hash.
- Commands with unapproved network access.

### Why

Agents often rerun tests, typechecks, and linters after no relevant input changed. A deterministic cache saves time, tokens, and tool noise.

### Risks

- Stale cache can hide real failures.
- Flaky tests can be incorrectly treated as deterministic.
- Environment-dependent commands can produce unsafe hits.
- Cached stdout/stderr can contain secrets.
- Cache lookup may cost more than rerunning small commands.

### Mitigations

- Cache is opt-in per command family until fixtures prove determinism.
- Store compact parsed result plus sidecar pointer, not raw stdout by default.
- Require explicit input manifests for each command family.
- Include redacted env shape, approved non-secret env values, and runtime/tool versions in the key.
- Mark flaky commands and recent failures as non-cacheable unless explicitly overridden.
- `ctx_cache explain` must show hit/miss reason and invalidation inputs.

### Test Plan

- Hit/miss fixtures for file change, lockfile change, config change, env shape change, runtime version change, branch change, and parser version change.
- Negative tests for install, migration, deploy, watch, interactive, stdin, and network command shapes.
- Secret redaction tests for cached result metadata.
- Performance test proving cache lookup overhead is below a configured threshold.
- Flaky-test fixture proving cache refuses unstable command family until policy allows it.

## Feature 16: Guard Scanner

### Proposal

Add a dedicated policy scanner over anything context-mode might return or persist.

Commands:

- `ctx_guard scan-output`
- `ctx_guard scan-sidecars`
- `ctx_guard scan-index`
- `ctx_guard scan-fixtures`
- `ctx_guard explain <artifact-id>`

Guard checks:

- Secret patterns, including known token prefixes, private keys, auth headers, cookies, and high-entropy strings.
- `.env` and credential-file shapes.
- ANSI/control sequences.
- Prompt-injection markers in fetched or command output.
- Untrusted-content labels before indexing.
- License and third-party attribution markers in release artifacts.
- Sidecar/index policy violations.

### Why

The output firewall becomes a persistence system once it writes sidecars, FTS rows, analytics, traces, and caches. A shared guard layer reduces the chance that every feature reimplements redaction differently.

### Risks

- False positives can block useful diagnostics.
- False negatives can leak secrets.
- Rule engines can become slow or hard to explain.
- Guard scans can mutate evidence needed for debugging.

### Mitigations

- Split actions into `redact`, `block-persistence`, `allow-return`, and `needs-review`.
- Keep raw evidence local and access-controlled only when policy allows it.
- Explain every guard hit with rule id, action, confidence, and target surface.
- Start with deterministic rules before adding heavier taint-style analysis.
- Scan before persistence and re-scan on retrieval.

### Test Plan

- Secret fixture suite across output, sidecars, FTS/index rows, cache entries, traces, and release artifacts.
- Prompt-injection and ANSI/control fixture tests.
- False-positive fixtures for harmless hashes, test tokens, and docs examples.
- Performance budget tests on large logs.
- Purge test proving blocked artifacts are not retained.

## Feature 17: Eval Harness

### Proposal

Add a first-class evaluation harness for compression correctness and router safety.

Commands:

- `ctx_eval parsers`
- `ctx_eval router`
- `ctx_eval redaction`
- `ctx_eval tool-broker`
- `ctx_eval no-critical-omissions`
- `ctx_eval all --json`

Fixture format:

```yaml
case: vitest-large-failure
input: fixtures/vitest/large-failed.log
command: pnpm vitest run
assert:
  contains:
    - "2 failed"
    - "src/parser.test.ts"
  not_contains:
    - "GITHUB_TOKEN"
  max_returned_tokens: 1200
  critical_fact_not_omitted: true
```

Evaluation areas:

- Parser summaries.
- Router decisions and rejected rules.
- Redaction and guard actions.
- Sidecar retention and retrieval.
- Output budget truncation.
- Native-tool bypass classification.
- Cache hit/miss correctness.
- Semantic diff inventory preservation.

### Why

Compression is useful only if it keeps the facts the agent needs. The eval harness proves summaries do not hide critical failures, redaction works, and router rules do not change command semantics.

### Risks

- Fixtures can be too synthetic.
- Golden outputs can make parser improvements painful.
- `critical_fact_not_omitted` can become subjective.
- Eval runtime can slow normal CI.

### Mitigations

- Use invariant assertions before full golden snapshots.
- Keep fixture provenance and real-world source notes.
- Separate fast PR evals from large nightly evals.
- Require every new parser/router rule to add at least success, failure, huge, ANSI, malformed, and secret fixtures.
- Store eval reports as release artifacts.

### Test Plan

- Meta-tests for fixture schema validation.
- Failing-fixture tests proving each assertion type catches real regressions.
- Coverage report showing parser/rule/guard/cache/diff fixtures by command family.
- CI gate for fast eval pack.
- Release gate for full eval pack.

## Near-Term Readiness For Features 13-17

These features are worth implementing soon, but they should not land as five independent tool islands. They share safety, persistence, output-budget, and eval concerns.

Readiness verdict:

| Feature | Spec readiness | Implementation priority | Public surface policy |
|---------|----------------|-------------------------|-----------------------------|
| `ctx_guard` | Implemented core | Highest | CLI/internal/experimental MCP only; scanner is a pipeline stage before persistence |
| `ctx_eval` | Implemented core | Highest | CLI/internal/experimental MCP only; release gate uses CLI scripts |
| `ctx_trace` | Implemented local views | High | CLI/internal/experimental MCP only; no external telemetry export |
| `ctx_diff` | Implemented git-text + optional Difftastic fallback | Medium-high | Public MCP/CLI; semantic provider failure falls open |
| `ctx_run_cached` | Implemented explicit canary | Last | CLI/internal/experimental MCP only; cache serving limited to `tsc --noEmit` |

Shared implementation contracts:

- Guard runs before any new trace, cache, sidecar, or index persistence.
- Eval fixtures are required before a parser, diff provider, cache family, or guard rule is marked supported.
- Trace writes are best-effort and must never block command execution.
- Semantic diff is a summarizer, not a replacement for raw Git inventory or sidecars.
- Task cache begins with explain mode plus opt-in hit serving for one command family at a time.
- Every new tool must use the existing tool registry, adapter output budgets, sidecar store, and session telemetry patterns instead of parallel plumbing.
- Every experimental MCP tool must be hidden from the default schema unless `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`.

Suggested module ownership:

- `src/guard/*`: guard rules, scan results, action decisions, redaction/block helpers.
- `src/eval/*`: fixture schema, runner, assertion engine, report writer.
- `src/trace/*`: trace event model, aggregation, `why-big` analysis, optional OTel mapping.
- `src/diff/*`: raw Git inventory, provider interface, text provider, optional Difftastic provider.
- `src/cache/*`: cache manifest, key builder, explain result, approved command-family policies.
- `src/tools/guard.ts`, `src/tools/eval.ts`, `src/tools/trace.ts`, `src/tools/diff.ts`, `src/tools/cache.ts`: MCP/CLI-facing tool handlers.
- `tests/guard/*`, `tests/eval/*`, `tests/trace/*`, `tests/diff/*`, `tests/cache/*`: focused feature tests.

Integration points to reuse:

- `src/tools/registry.ts` for MCP tool registration and response tracking.
- `src/adapters/openclaw/mcp-tools.ts` for exposed tool metadata.
- `src/adapters/output-budget.ts` for returned-output limits.
- `src/artifacts/run-store.ts` for raw sidecar retention and retrieval.
- `src/filters/pipeline.ts` for redaction/control stripping until `src/guard/*` becomes the shared engine.
- `src/session/db.ts` and `src/session/event-emit.ts` for local session events.
- `scripts/release-candidate-reports.mjs` for eval/guard/release report artifacts.

Recommended PR order:

1. Guard core: deterministic scanner, rule ids, actions, fixtures, and scan-output command. Wire no broad persistence yet.
2. Eval core: fixture schema, assertion engine, parser/redaction fixtures, `ctx_eval all --json` fast pack.
3. Guard integration: sidecar, FTS/index, trace, cache, and release-artifact scan hooks with fail-closed persistence for critical hits.
4. Trace MVP: local trace events, `ctx_trace --latest`, `ctx_trace --why-big`, privacy snapshots, fail-open DB tests.
5. Diff MVP: raw Git inventory plus text semantic summary, sidecar pointer, risk reason codes; optional Difftastic provider behind capability detection.
6. Cache explain MVP: command-family manifest and `ctx_cache explain`.
7. Cache serving canary: one low-risk command family, currently `tsc --noEmit`, with source-file invalidation fixtures and a kill switch.

Do not broaden task-cache hit serving or require Difftastic installation. The current cache canary and optional Difftastic capability detection are enough until eval evidence proves more families/providers safe.

## Implementation Contract Addendum For Features 13-17

This addendum closes the implementation-readiness gaps found in final review. These contracts are required before coding the feature families beyond scaffolding.

### `ctx_diff` Contract

MVP provider policy:

- `git-text` is always available and is the default provider.
- `difftastic` is optional, capability-detected, never auto-installed, and never required for tests to pass.
- Embedded Tree-sitter diff remains future-scoped.
- Provider metadata must include provider name, provider version if available, timeout, max input bytes, fallback reason, and supported/unsupported file count.
- Provider failure falls back to `git-text` and returns a warning instead of failing the tool.

Canonical inventory is collected separately from hunk parsing. `ctx_diff` must not rely on the current compact `git-diff` parser for inventory. Use Git plumbing such as `git diff --name-status -z`, `git diff --numstat -z`, `git diff --summary`, and `git diff --raw -z` as needed.

Inventory statuses must cover:

- added
- modified
- deleted
- renamed
- copied
- type changed
- mode-only
- binary
- submodule
- unmerged
- conflict-marker-present
- unknown

Result shape:

```ts
interface CtxDiffResult {
  schemaVersion: 1;
  provider: {
    name: "git-text" | "difftastic" | "tree-sitter";
    version?: string;
    status: "ok" | "fallback" | "failed";
    fallbackReason?: string;
    elapsedMs: number;
    maxInputBytes: number;
    supportedFileCount?: number;
    unsupportedFileCount?: number;
  };
  inventory: Array<{
    path: string;
    oldPath?: string;
    status: string;
    additions?: number;
    deletions?: number;
    binary?: boolean;
    modeChange?: string;
    submodule?: boolean;
  }>;
  semanticGroups: Array<{
    kind: "formatting" | "move" | "rename" | "api" | "test" | "generated" | "lockfile" | "textual" | "unknown";
    files: string[];
    summary: string;
    confidence: "low" | "medium" | "high";
  }>;
  risk: {
    level: "low" | "medium" | "high" | "critical";
    reasons: Array<{
      code:
        | "deleted_file"
        | "binary_change"
        | "submodule_change"
        | "mode_change"
        | "lockfile_change"
        | "generated_change"
        | "public_api_change"
        | "test_surface_changed"
        | "conflict_marker"
        | "provider_failed"
        | "large_diff_truncated"
        | "unknown_inventory";
      confidence: "low" | "medium" | "high";
      files: string[];
      detail: string;
    }>;
  };
  rawSidecarRunId?: string;
  warnings: string[];
}
```

Sidecar/security behavior:

- `ctx_diff --raw-sidecar` stores only redacted diff text.
- Raw unredacted diff persistence is forbidden.
- Critical guard findings block sidecar persistence and return a compact finding summary instead.
- Diff sidecars use normal retention/TTL unless explicitly pinned.
- Sidecar retrieval goes through `ctx_fetch_run` or the future exact artifact resolver, never direct file paths.

Required fixtures:

- simple modified file
- added/deleted file
- rename/copy
- mode-only change
- binary change
- submodule change
- lockfile change
- generated bundle change
- formatting-only change
- moved function
- public export/API change
- conflict markers
- large truncated diff
- provider missing/failure fallback
- Windows path and quoting case
- secret redaction inside diff

### `ctx_trace` Contract

Trace storage must not reuse raw `session_events.data` as the only source of truth. Either add dedicated trace tables or define an explicit event-extension contract with equivalent guarantees.

Minimum local trace schema:

```ts
interface TraceSpanRecord {
  schemaVersion: 1;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sessionId: string;
  sourceEventId?: string;
  spanType: "task" | "tool" | "router" | "parser" | "sidecar" | "guard" | "cache" | "bypass";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "ok" | "error" | "unavailable" | "skipped";
  adapter: string | "unknown";
  agent: string | "unknown";
  toolName?: string;
  parser?: string;
  routeRule?: string;
  bytesReturned?: number;
  bytesAvoided?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  commandCategory?: string;
  redactedArgvShape?: string;
  commandHash?: string;
  sidecarRunId?: string;
  guardVersion?: string;
  metadataJson: string;
}
```

Indexes:

- `sessionId, startedAt`
- `traceId, spanId`
- `spanType, startedAt`
- `adapter, agent, startedAt`
- `toolName, startedAt`

Privacy allowlist:

- Allowed: tool name, adapter id, agent id when provided by host, parser id, route rule id, byte counts, estimated token counts, latency, status, redacted argv shape, salted command hash, sidecar id, guard version, failure code.
- Forbidden by default: full command text, raw stdout/stderr, raw file paths outside project-relative redacted display, environment values, HTTP bodies, secrets, cookies, auth headers, unredacted URLs, prompt content.
- Existing route events that contain raw command text must be sanitized before `ctx_trace` exposes them.
- Command hash salt is local per user/config root and is never exported by default.

Query contract:

- `ctx_trace --latest`
- `ctx_trace --session <id>`
- `ctx_trace --last-days <n>`
- `ctx_trace --limit <n>`
- `ctx_trace --span-type <type>`
- `ctx_trace --tool <name>`
- `ctx_trace --parser <name>`
- `ctx_trace --adapter <id>`
- `ctx_trace --why-big`
- `ctx_trace --tool-breakdown`
- `ctx_trace --json`

`ctx_trace --json` returns `{ schemaVersion, available, scope, spans, rollups, warnings }`. If the DB is locked, missing, or migration fails, return `available:false` with a warning and do not block the caller.

Migration/fail-open rules:

- Trace migrations are additive, idempotent, and non-destructive.
- Trace DB setup must be isolated from core SessionDB startup.
- Trace writes use short busy timeouts and fail open.
- Trace reads fail open with `available:false`.
- Trace retention is configurable and included in `ctx purge`.

Attribution precedence:

1. Explicit tool context adapter/agent fields.
2. Host hook metadata.
3. Session event attribution.
4. Environment-detected adapter.
5. `"unknown"`.

### `ctx_run_cached` Contract

`ctx_cache explain` is the baseline. Cache-hit serving is advertised only for explicit canary families whose invalidation, replay, env, concurrency, and guard contracts pass. Current canary: `tsc --noEmit`.

CLI shape:

- `context-mode cache explain -- <command...>`
- `context-mode cache run -- <command...>`
- `context-mode cache list`
- `context-mode cache purge [--dry-run|--confirm]`
- The `--` delimiter and argv parsing must match `context-mode run`.
- Commands with stdin are classify-only unless a command-family manifest explicitly enables redacted stdin hashing.

Manifest shape:

```ts
interface CacheFamilyManifest {
  schemaVersion: 1;
  familyId: string;
  commandMatcher: {
    executable: string;
    argsAllowlist: string[];
    argsDenylist: string[];
  };
  mode: "explain-only" | "serve-hits";
  inputResolvers: Array<{
    kind: "glob" | "lockfile" | "config" | "git-index" | "runtime" | "env" | "tool-version";
    value: string;
    required: boolean;
  }>;
  envPolicy: {
    hashAllowedValues: string[];
    hashPresenceOnly: string[];
    disableOnSecretLikeEnv: boolean;
  };
  sideEffectPolicy: {
    allowedOutputs: string[];
    forbiddenFlags: string[];
    network: "deny" | "allow";
    stdin: "deny" | "hash-redacted";
    tty: "deny";
  };
  replayPolicy: {
    storeStdoutSummary: boolean;
    storeStderrSummary: boolean;
    requireSidecarOnHit: boolean;
    rematerializeSidecarOnHit: boolean;
  };
  guardVersion: string;
}
```

Hash/invalidation rules:

- Use content hashes, not mtimes.
- Include deleted/new file detection from the resolved input set.
- Canonicalize paths with Windows case and symlink behavior covered by tests.
- Include lockfiles, package/tool config, relevant tsconfig/eslint/pytest/go env files, runtime/tool versions, parser version, context-mode version, git root, branch, and commit/index state when relevant.
- Hash approved non-secret env values such as `NODE_ENV`, `CI`, `TZ`, locale, build tags, and family-specific flags.
- If secret-like env is present and the family can observe env, disable cache serving unless the manifest explicitly allows it.

Initial canary:

- Only `tsc --noEmit` is eligible for first `serve-hits` canary.
- `eslint`, `vitest run`, `pytest`, `go test`, and read-only Git summaries remain explain-only until command-family fixtures prove side-effect and invalidation safety.
- Reject `--fix`, coverage, snapshot/update, report-output, watch, arbitrary package scripts, install, migration, deploy, and networked commands unless a manifest explicitly proves safety.

Replay semantics:

- Cache hits preserve exit code, signal/timeout/cap metadata, parser id/version, parser result, stdout summary, stderr summary, and output-budget truncation behavior.
- If required sidecar content is missing, purged, guard-version mismatched, or unreadable, treat as cache miss and rerun.
- Cache-owned sidecars may be re-materialized as fresh run sidecars for retrieval, but never expose stale direct paths.

Storage/concurrency:

- Cache entries are written atomically by temp-write/rename or SQLite transaction.
- Concurrent same-key runs use per-key single-flight locking or safely allow duplicate execution; corrupt/locked cache fails open to normal execution.
- `ctx_cache purge --dry-run` returns exact entries and bytes that would be removed.
- Cache TTL/quota cleanup never deletes an entry actively being served.
- `ctx_cache` MCP exposure remains experimental-gated; CLI is the primary release-gate surface.

### `ctx_guard` Contract

Guard data contracts:

```ts
type GuardSurface = "chat" | "sidecar" | "index" | "trace" | "cache" | "eval-fixture" | "release-artifact";
type GuardSeverity = "info" | "low" | "medium" | "high" | "critical";
type GuardAction = "allow" | "redact" | "block-persistence" | "block-return" | "needs-review";

interface GuardFinding {
  ruleId: string;
  severity: GuardSeverity;
  action: GuardAction;
  surface: GuardSurface;
  confidence: "low" | "medium" | "high";
  byteStart?: number;
  byteEnd?: number;
  redactionLabel?: string;
  message: string;
}

interface GuardDecision {
  schemaVersion: 1;
  guardVersion: string;
  surface: GuardSurface;
  status: "allow" | "redacted" | "blocked" | "needs-review" | "unavailable";
  findings: GuardFinding[];
  redactedText?: string;
  counts: Record<string, number>;
}
```

Fail behavior:

| Surface | Scanner failure | Critical finding |
|---------|-----------------|------------------|
| chat return | fail open with warning after existing redaction | redact or block return depending on rule |
| sidecar persistence | fail closed | block persistence |
| index/FTS persistence | fail closed | block persistence |
| trace persistence | fail closed for sensitive metadata, otherwise drop trace | block sensitive fields or drop span |
| cache persistence/hit | fail closed to cache miss | block entry or miss |
| release artifact scan | fail release gate | fail release gate |

Secret fixture corpus must include:

- AWS access keys, secret keys, and session tokens.
- GitHub classic, fine-grained, OAuth, app, and refresh token shapes.
- OpenAI project/service tokens.
- npm, PyPI, Slack, Stripe, Azure, Google, and generic bearer tokens.
- SSH/private key blocks and kubeconfig credentials.
- `.env`, `.npmrc`, `.netrc`, and auth config shapes.
- Authorization, cookie, API-key, and credentialed URL headers.
- JWTs, high-entropy base64/hex candidates, query-string tokens.
- False-positive examples for hashes, UUIDs, docs placeholders, and test tokens.

Sidecar/artifact resolver rules:

- Use exact opaque artifact IDs for future guarded retrieval.
- Do not authorize by caller-supplied local path or metadata `rawPath`.
- Resolve realpaths server-side under the private artifact root.
- Reject symlinks, hardlinks, path traversal, ambiguous prefixes, wrong project hash, and wrong session ownership.
- Re-scan and re-redact after read, before preview or return.

Untrusted content and FTS:

- Persist `sourceKind`, `trusted`, and `sourceLabel` for indexed chunks.
- Snippets from web, command output, logs, and sidecars are evidence, not instructions.
- Render untrusted snippets with an explicit marker and escaped instruction-looking text.
- Fixtures must include fake `AGENTS.md`, `system`, `developer`, `tool`, and credential-exfiltration instructions.

Binary/control handling:

- Guard scans bytes before UTF-8 decoding.
- Invalid UTF-8, NUL-heavy content, C0/C1 controls, OSC52 clipboard sequences, and terminal hyperlinks are blocked from preview unless a parser declares support.
- Binary-like sidecars/index/cache/trace payloads are not summarized by default.

Guard/redaction versioning:

- Trace and cache entries store guard/redaction version.
- Cache hits fail closed to miss when guard is unavailable or version mismatches.
- Retrieval re-scans with the current guard version.

Guard report schema:

```ts
interface GuardScanReport {
  schemaVersion: 1;
  generatedAt: string;
  guardVersion: string;
  subjects: Array<{ surface: GuardSurface; pathOrId: string; status: string; findings: number }>;
  totals: Record<GuardSeverity, number>;
  failed: boolean;
}
```

Release fails on any critical finding or unavailable required guard scan.

### `ctx_eval` Contract

Eval fixtures use typed facts, not subjective booleans.

```yaml
case: vitest-large-failure
schemaVersion: 1
commandFamily: vitest
parserFamily: vitest
gateTier: fast
input:
  kind: file
  path: fixtures/vitest/large-failed.log
facts:
  - id: failed-count
    severity: critical
    source: raw-log
    expectedSurface: summary
    jsonPath: $.summary.failed
    equals: 2
  - id: primary-file
    severity: critical
    source: raw-log
    expectedSurface: important
    contains: src/parser.test.ts
assert:
  forbiddenText:
    - GITHUB_TOKEN
  maxReturnedTokens: 1200
  requiredReasonCodes:
    - test_failure
  forbiddenOmissions:
    - failed-count
    - primary-file
```

Required assertion types:

- required text
- forbidden text
- required JSON path
- numeric equality/range
- required reason code
- forbidden omission by fact id
- max returned bytes/tokens
- guard finding expectation
- cache decision expectation
- diff inventory expectation

Coverage manifest integration:

- Command coverage entries reference concrete fixture IDs, assertion bundles, command family, gate tier, and latest `ctx_eval` result.
- `fixture-coverage.json` must report passed, failed, skipped, and missing fixture IDs, not only test-file presence.
- Feature 13-17 tests may not use `.skip` without a skip manifest entry containing owner, reason, and non-expired expiry. Private-fork quarantines live in `tests/skip-manifest.json` and are enforced by `npm run skip:audit:strict`.

Snapshot policy:

- Snapshot only canonical structured projections.
- Do not snapshot full human prose unless the output is intentionally static.
- Use invariant assertions for facts, reason codes, inventory, guard outcomes, and cache decisions.

Scripts and reports:

- Add `eval:fast`, `eval:full`, and `guard:fixtures` scripts before advertising the features.
- CI runs `eval:fast` and `guard:fixtures`.
- Release verification runs `eval:full`, `guard:fixtures`, semantic diff fixture report, and task-cache readiness report when those features ship.

Eval report schema:

```ts
interface CtxEvalReport {
  schemaVersion: 1;
  generatedAt: string;
  fast: boolean;
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    missing: number;
  };
  failures: Array<{
    case: string;
    assertion: string;
    severity: "medium" | "high" | "critical";
    message: string;
  }>;
  failed: boolean;
}
```

Release fails on any critical eval failure, missing fast fixture, or expired skip.

## Implementation Phases

### Phase 0: Groundwork

- Move more MCP handlers from `src/server.ts` into `src/tools/*` using `src/tools/registry.ts`.
- Define shared `FilterResult`, `RouteDecision`, and `RunArtifact` types.
- Add fixtures for noisy command outputs.
- Add versioned config schema and effective-config resolver.
- Add feature flags and adapter overrides.
- Add threat-model fixtures for secrets, prompt injection, path traversal, and ANSI controls.
- Add benchmark harness and baseline raw-output measurements.
- Extract shared classifier from existing hook routing/policy paths instead of creating parallel logic.
- Define `FilterPipeline` seam and where server handlers call it.
- Define hook bundle/runtime strategy for shared routing.

Exit criteria:

- Existing tests pass.
- One migrated tool uses automatic `trackResponse`.
- Shared types compile and are documented.
- Config loads with precedence and rejects unknown schema versions.
- Router defaults to `off` or `recommend`, never mutation.
- Baseline benchmark report exists.
- Tool extraction boundaries are documented.
- Bundle/assert-bundle coverage includes any hook-shared routing artifacts.

### Phase 1: Passive Rewrite And Analytics

- Add rewrite registry in recommendation mode.
- Add parser registry with git status, rg, and vitest/npm test.
- Record route decisions, parser confidence, parse failures, and missed opportunities.
- Add `ctx_gain --json` minimal export.
- Add `ctx_discover --session latest` over fixture session data.
- Keep all adapters in recommendation mode.

Exit criteria:

- No command behavior mutation yet.
- `ctx_discover --session latest` can report bypasses from fixture sessions.
- Savings estimates available per parser.
- Local analytics privacy snapshot tests pass.
- `ctx doctor` reports router mode and config source.

### Phase 2: Sidecars And Fetch-Run

- Add run artifact store.
- Add streaming redacted raw sidecar capture in or immediately around `PolyglotExecutor`.
- Add `ctx_fetch_run` with slice/search-first defaults.
- Add quota, TTL, and ownership enforcement.

Exit criteria:

- Large failing test output returns compact summary plus sidecar pointer.
- Full raw output never enters chat unless explicitly requested.
- Sensitive fixtures are redacted in both summary and sidecar.
- Raw sidecars are not indexed into FTS.
- Cleanup respects configured project and run limits.

### Phase 3: `ctx_read`

- Add `ctx_read` modes.
- Add repeated read hash cache.
- Update tool descriptions and rules-file guidance.
- Add discover rule for raw read floods.
- Add compatibility docs for when `ctx_execute_file` remains preferred.

Exit criteria:

- Large file read returns map/outline by default.
- Full read requires reason.
- Repeated unchanged read is collapsed.
- Denied and sensitive paths are neither returned nor cached.

### Phase 4: Controlled Hook Rewrite

- Enable auto-rewrite for a narrow allowlist: `git status`, `rg`, `grep`, `npm test`, `pnpm test`, `pytest`.
- Keep `curl` and `wget` recommendation-only until URL/SSRF safety policy, redirect validation, header redaction, and side-effect fixtures pass.
- Add adapter tier reporting to `ctx doctor`.
- Add OpenClaw/Codex multi-home installer validation.
- Start with one adapter in canary mode before expanding.
- Require `CTX_MODE_ROUTER=rewrite` or adapter-specific rewrite flag.

Exit criteria:

- Hook rewrite works in supported clients.
- Unsupported clients get explicit tier 2 or tier 3 guidance.
- Fail-open parser crash tests pass.
- One-command kill switch disables rewrite without uninstalling hooks.
- Adapter contract test proves mutation and fallback behavior.
- Shadow-mode metrics meet rewrite thresholds.
- No adapter is marked tier 1 unless capability metadata proves input mutation.

### Phase 5: Dashboard And Policy Hardening

- Add insight dashboard panels for savings, misses, parser failures, raw usage, and top bypasses.
- Add retention controls for sidecars.
- Add security checklist and test gate for filters.
- Add adapter matrix view and config-source view.

Exit criteria:

- Dashboard identifies top missed savings without raw context flooding.
- Sidecar retention is bounded.
- Security fixtures run in CI.
- Dashboard does not expose full commands, raw output, or secrets by default.

### Phase 6: Trace, Guard, Diff, And Eval Hardening

- Add local trace schema and `ctx_trace` views behind experimental MCP gating.
- Add `ctx_guard` scanner and route persistence/cache/sidecar paths through it.
- Add `ctx_eval` fixture runner for parsers, router rules, redaction, sidecars, and omission checks.
- Add semantic diff provider interface, git-text inventory fallback, and optional Difftastic capability detection.
- Keep all external telemetry export disabled.

Exit criteria:

- `ctx_trace --why-big` explains fixture sessions without raw output.
- Guard scanner blocks or redacts secret fixtures before persistence.
- `ctx_eval all --json` passes on fast fixtures.
- `ctx_diff --semantic` preserves raw Git file inventory and fails open to text summary.
- Release reports include eval, guard, skip-audit, semantic-diff, and task-cache readiness results.

### Phase 7: Deterministic Task Cache

- Add cache manifest format and command-family approvals.
- Add `context-mode cache explain` and `context-mode cache run`.
- Start with explicit `tsc --noEmit` serving only.
- Exclude install, migration, deploy, watch, interactive, stdin, and unsafe-network commands by default.

Exit criteria:

- Cache hits preserve exit code, stdout/stderr summary, parser result, and sidecar pointer semantics.
- Cache misses explain the invalidating input.
- File, lockfile, config, env-shape, runtime, branch, and parser-version changes invalidate correctly.
- Secret fixtures are not persisted in cache metadata or artifacts.

## Release Engineering Gates

Release candidates must produce and retain these CI artifacts:

- `benchmark-report.json`
- `adapter-validation-report.json`
- `schema-snapshot.json`
- `fixture-coverage.json`
- `ctx-eval-report.json`
- `guard-scan-report.json`
- `skip-audit-report.json`
- `trace-privacy-report.json` once `ctx_trace` ships.
- `semantic-diff-fixture-report.json` once broader semantic diff fixture reporting ships.
- `task-cache-readiness-report.json` once `ctx_run_cached` ships.
- `release-checklist.md`

Release checklist:

- Supported Node/runtime matrix matches `package.json` engines and CI workflows.
- `npm pack --dry-run` passes.
- Temporary install smoke passes from the packed artifact.
- Bundle drift and `assert-bundle` checks pass.
- Plugin manifest version sync passes.
- MCP schema snapshot diff is reviewed.
- Config/schema migration tests pass from the previous released version.
- Session DB migration tests pass from the previous released version.
- Sidecar purge and retention tests pass.
- Adapter capability matrix is regenerated or validated.
- External telemetry remains absent or explicitly gated behind a separate reviewed feature.
- SPDX/license scan passes.
- Third-party dependency license check passes.
- Generated `NOTICE` file is reviewed if RTK code or any other third-party code is copied instead of only used as design inspiration.
- SBOM is generated and retained as a CI artifact.
- Release artifacts include signed checksums, or a documented reason signing is not yet available.
- Binary releases include provenance/attestation before being advertised as trusted installs.
- Install scripts pass shellcheck/security review and avoid executing remote scripts without user-visible source and checksum guidance.
- `ctx_eval all --json` fast pack passes before release.
- Guard scan over sidecars, index fixtures, cache fixtures, trace fixtures, and release artifacts passes.
- Trace schema/privacy report passes before `ctx_trace` is advertised.
- Semantic diff fixtures prove raw Git file inventory preservation before new `ctx_diff --semantic` providers are advertised.
- Task cache fixtures prove invalidation for every approved command family before cache serving is advertised beyond the explicit canary.

## Acceptance Metrics

- At least 80 percent reduction in returned bytes for supported noisy commands.
- Zero known secret fixture leaks into chat, FTS, sidecars, or analytics.
- Parser failure never crashes MCP server or client hook.
- `ctx_discover` identifies top bypasses from test fixture sessions.
- `ctx_read` prevents repeated unchanged large file reads.
- `ctx doctor` reports active integration tier per installed adapter.
- Router classification latency is under 50 ms p95 on fixture commands.
- Sidecar storage respects configured per-run, per-project, and TTL limits.
- Known test/build failures are never omitted from parser summaries.
- External telemetry remains disabled unless explicitly enabled.
- Existing MCP tool schemas remain backward-compatible.
- `CTX_MODE_ROUTER=off` disables all auto-rewrite behavior.
- Adapter contract tests pass before any adapter moves to tier 1 supported.
- `benchmark-report.json`, `adapter-validation-report.json`, `schema-snapshot.json`, `fixture-coverage.json`, `eval-full-report.json`, `guard-fixtures-report.json`, strict `skip-audit-report.json`, and `release-checklist.md` are generated for release candidates.
- Supported Node/runtime matrix matches `package.json` engines and CI workflows.
- `npm pack --dry-run`, temporary install smoke, bundle drift check, plugin manifest version sync, MCP schema snapshot diff, and config/session migration tests pass before release.
- `ctx_trace --why-big` identifies top token/context causes from fixture sessions.
- `ctx_guard` has zero known critical fixture leaks across chat, FTS, sidecars, analytics, traces, and caches.
- `ctx_eval no-critical-omissions` passes for supported parser families.
- `ctx_diff --semantic` falls back safely and never loses raw file inventory.
- Cache serving is disabled for unapproved command shapes and explains every hit or miss.

## Open Questions

- What is the max acceptable overhead for router and analytics on every tool call?
- Should raw sidecars be encrypted at rest or treated as normal local cache files?
- Should `default-rewrite` ever ship globally, or should rewrite remain per-adapter opt-in after a full minor release of recommendation-mode analytics?
- Which adapter should be the first tier-1 canary after capability tests prove input mutation?
- After optional Difftastic fallback, should semantic diff add embedded Tree-sitter, language-server providers, or both behind capability detection?
- Which trace fields are safe enough for optional OTLP export, and should export ever include command hashes?
- Which command families are deterministic enough for default `ctx_run_cached` approval after fixture coverage?

## Recommended First PR

Implement passive route decisions, shared types, config schema, architecture seams, and benchmark fixtures only.

Scope:

- `src/routing/types.ts`
- `src/routing/rewrite-registry.ts`
- `src/routing/command-classifier.ts`
- `src/config/context-mode-config.ts`
- `src/filters/types.ts`
- `src/filters/pipeline.ts`
- `ctx route --explain` data model and golden output fixtures.
- Command coverage manifest schema and first low-risk entries.
- Interactivity/stdin classification fields.
- Concurrency/locking test harness for sidecars and analytics.
- Existing hook routing integration or generated shared routing table.
- Existing session DB route-decision event extension.
- `tests/routing/rewrite-registry.test.ts`
- `tests/config/context-mode-config.test.ts`
- `tests/routing/route-explain.test.ts`
- `tests/routing/command-coverage-manifest.test.ts`
- `tests/concurrency/sidecar-analytics-locking.test.ts`
- `tests/fixtures/noisy-output/*`
- Minimal analytics event type for route decisions.
- `docs/rtk-inspired-context-mode-spec.md` updates as the planning source.

No command mutation in the first PR. This proves classification, config precedence, tool/hook integration seams, test fixtures, benchmark shape, and data contracts before changing runtime behavior.
