# Context Mode Review Fix Spec - 2026-05-19

## Goal

Close the validated review findings around project-scoped execution, security policy enforcement, index isolation, sidecar retrieval, router safety, dependency audit status, and telemetry accuracy without losing the token-saving behavior Context Mode already provides.

## Source Reviews

This spec is based on the validated review findings discussed on 2026-05-19. Additional pasted reviews must be merged into the intake section before implementation starts.

### Intake - Tier2/Refactor Deep-Dive Review

Validated additions from the first follow-up review:

- `projectDir` override currently accepts any absolute path. This must become a trusted, validated override, not arbitrary caller-controlled filesystem scope.
- `cwd` currently accepts any absolute path. It must resolve under the effective validated project root.
- Bash deny policy still reads `process.env.CLAUDE_PROJECT_DIR`, which skips deny enforcement for non-Claude adapters and ignores request-scoped project overrides.
- OpenClaw `safe()` returns text errors without `isError: true`.
- OpenClaw bridge schemas advertise fields that bridge stubs do not actually honor.
- `fetchRunArtifact` run-id lookup accepts loose prefixes and also matches artifact-directory suffixes.
- `cleanupRunArtifacts` rebuilds filtered arrays inside its byte-cap loop and has no inter-process cleanup coordination.
- JavaScript/Python network deny preloads are defense-in-depth only; JS still has worker/thread, child-process, http2, and raw-socket gaps, and the network byte accounting only covers fetch/http/https paths.
- `CM_FS_PRELOAD` is written to the OS temp directory at server import time and is not cleaned up on process exit.
- Sidecar POSIX permission modes do not harden Windows ACLs.
- `getProjectDir()` calls platform detection on the hot path.
- `withOptionalProjectDir` drops host `sessionId` attribution.
- macOS temp-dir discovery runs synchronous startup syscalls without a timeout.
- `writeAtomic` can leave a `.tmp` file if `renameSync` fails.
- Store cleanup comments claim WAL PID parsing that the code does not perform.

Partially valid or lower-priority from the first follow-up review:

- The OpenClaw bridge mismatch is real, but the current bridge does return an explicit stub message. The risk is schema/runtime confusion, not a silent real `ctx_fetch_run` head-preview result.
- `ctx_index` OpenClaw schema no longer requires `source`, but it still lacks a `content`-or-`path` `oneOf` contract.
- The markdown chunker oversized single-codepoint concern is theoretically valid but very low practical impact. Oversized fenced code preservation is already intentional and should be documented/tested.
- `cliRedirect` namespace advice looks correct for the current `mcp__context_mode__` namespace in this environment; keep this as unverified for other OpenClaw namespace shapes.

### Intake - Working-Tree Follow-Up Review

Validated additions from the last follow-up review:

- `ctx_fetch_run` labels full raw artifact output as a preview even when the artifact was not truncated.
- `ctx_cache` approved execution inherits stdin from the MCP server process.
- `runTaskCached` has no direct tests beyond adjacent cache explanation coverage.
- `ctx_upgrade`, plugin-cache integrity, bundle assertion, asymmetric-drift assertion, and healing scripts have little or no direct test coverage despite release/security relevance.
- The skip manifest has all entries owned by `private-fork` and all expiries set to `2026-12-31`, creating a synchronized cliff.
- `scripts/pre-commit.mjs` currently runs only TypeScript and asymmetric-drift checks, while release guidance expects more local gates.
- Markdown chunking currently has O(n squared) paths for growing unit joins and long non-code line splitting.
- `src/artifacts/redaction.ts` is a thin facade over `filters/pipeline.ts`, so docs/specs should point incident triage at the real implementation.
- `failureFocusFilter` keeps the first 25 failure-looking lines, which can hide downstream crash context in long stderr.
- Generic secret assignment redaction drops quote style around redacted values.
- `sliceUtf8TailBytes` allocates `Array.from(text)` for large strings.
- Markdown code-fence closing detection requires exact fence equality, while markdown allows a closing fence at least as long as the opener.
- `supply-chain-check.mjs` path label stripping is brittle across Windows drive-letter casing.

Stale or partial from the last follow-up review:

- The OpenClaw schema test gap is partially resolved: current tests already cover `ctx_execute` `projectDir`/`cwd`/`intent`/`parser`, `ctx_batch_execute` `projectDir`/`cwd`, and `ctx_fetch_run` `preview`. It still needs full table coverage and runtime/stub behavior tests.
- The dirty `cli.bundle.mjs` / `server.bundle.mjs` claim was not current when checked.
- No tracked `.openclaw-install*.log` files were found when checked.
- The CI doctor `continue-on-error` claim was not current in `.github/workflows/ci.yml`.
- References to `skills/context-mode-ops` were found only in ignored graphify output and the review document, not active user-facing docs.

### Intake - Subagent Weak-Point Review

Validated additions from the subagent review swarm:

- File-backed `ctx_index(path)` redacts content on initial index, but stale-source auto-refresh can subsequently re-read and index raw unredacted file contents.
- Session-event auto-indexing scans every `*-events.md` file in the shared adapter sessions directory, indexes them into the currently opened store, and deletes them.
- `ctx_insight` accepts caller-controlled `port` and `sessionDir`; a fresh caller-selected cache can set `sourceUpdated=true` and kill any local listener on that port.
- `ctx_insight` derives cache/write/install/delete locations from caller-controlled `sessionDir`, creating a separate path-write trust boundary outside `projectDir` / `cwd`.
- Experimental `ctx_guard scan-file` reads `input.path` directly and can return redacted previews or finding metadata without `ctx_read` path policy checks.
- `ctx_fetch_and_index` persists and returns full URL strings as source labels, including query strings that may contain signed URL or token material.
- Timeline search labels persistent ContentStore hits as `current-session` because search rows drop session/event attribution.
- `ctx_search(source)` uses SQL `LIKE` without escaping `%` and `_`, so scoped source searches can unintentionally broaden.
- OpenClaw plugin DB and slash-command state are module-level singletons despite per-project/session expectations.
- Checked-in `configs/codex/hooks.json` is stale versus the adapter matcher and packaged `.codex-plugin/hooks.json`.
- OpenClaw hook constants/generator still expose colon `tool_call:*` names while runtime uses `before_tool_call` / `after_tool_call`.
- OpenClaw docs and diagnostics claim context-mode owns compaction, but runtime deliberately sets `ownsCompaction: false`.
- Static OpenClaw AGENTS/docs use `context-mode__ctx_*` examples while the active tool-naming path in this environment uses `mcp__context_mode__.ctx_*`.
- OpenClaw manifests cover only stable tools even though runtime can register experimental bridge tools when experimental mode is enabled.
- Bundle auto-update workflow omits `hooks/security.bundle.mjs` and `hooks/rewrite-registry.bundle.mjs` from the staged bundle set.
- CI test wrapper can return success on any output containing `Tests.*passed`, even when Vitest exits nonzero for non-allowlisted reasons.
- CI/release gates do not run `npm audit --omit=dev` or a real secret scanner.
- CI workflows use `npm install` instead of `npm ci`.
- `ctx_search` refreshes every file-backed source synchronously before every query.

Rejected, stale, or already covered from the subagent review swarm:

- Existing projectDir/cwd trust-boundary, fetch-run, cache stdin, sandbox network, singleton store, and release-test-backfill items were duplicates already in this spec.
- `context-mode__ctx_*` naming is valid in some OpenClaw MCP-prefix setups, but stale for the dynamic routing block in this Codex/OpenClaw environment. Treat the issue as generated guidance drift, not a single universal namespace bug.

### Intake - Context Mode Usage Feedback

Operational feedback from the review agents:

- Context Mode was effective at keeping large diff, test, audit, and sidecar output out of the live context window.
- `ctx_gain` and `ctx_discover` are useful directionally but currently report broad session/process totals, not a clean task-local slice.
- `ctx_discover` cannot prove native Read/Grep/Glob or shell bypass absence unless the adapter reports native tool events.
- `ctx_read` can still be too verbose for deep review, especially huge generated docs, Graphify reports, large outlines, and adjacent slices from the same file.
- `ctx_batch_execute` can return noisy indexed-section inventories when a command creates many sections.
- `ctx_search` can surface stale or wrong-project indexed content unless carefully scoped.
- `ctx_index` can index large generated reports too coarsely for precise follow-up search.
- `ctx_route` handles compound commands conservatively as classify-only; correct, but clunky during investigations.
- `ctx_route` should flag mutating commands more aggressively. This overlaps the existing router-safety slice.
- `ctx_execute` `projectDir` and `cwd` semantics are easy to confuse. This overlaps the existing projectDir/cwd safety and schema-parity slices.
- `ctx_fetch_run` `preview: "tail"` helps, but returned previews can still be truncated by adapter budgets and default head preview is easy to misuse for logs.
- Windows shell/path ergonomics need improvement for absolute paths, quoting, drive letters, and cross-shell execution.
- OpenClaw bridge stubs remain confusing unless clearly marked as non-executing stubs.
- `ctx_doctor` still surfaced Mono/Mochi missing recent prompt-marker warnings.

## Pre-Fix Validation Summary

Original high-impact findings validated from the reports:

- Effective `projectDir` is not consistently used for security policy checks.
- Caller-provided `projectDir` and `cwd` are not constrained to a trusted project root or allowlist.
- The content store is process-global, so project-specific indexing/search can leak or mix across repos.
- File-backed source auto-refresh can re-index raw unredacted file contents after an initially redacted index.
- Session-event auto-indexing can ingest and delete other projects' event files from a shared sessions directory.
- `ctx_insight` exposes caller-controlled path/write/install/delete and port-kill behavior outside the normal projectDir/cwd trust boundary.
- Earlier `npm audit --omit=dev` runs reported production advisories: high `fast-uri`, moderate `hono`, `ip-address`, and `express-rate-limit`; the implementation log below records the passing rerun after dependency updates.

Original medium-impact findings validated from the reports:

- Before this fix set, `ctx_execute_file`, `ctx_index`, and `ctx_search` lacked complete `projectDir` support.
- `ctx_fetch_run` can read symlinked raw artifacts because artifact paths are checked lexically instead of by real path.
- Explicit `runId` recovery only searches the newest 200 artifacts.
- Sidecar `maxRunBytes` is approximate because truncation markers can push stored bytes over the configured cap.
- Mutating lint commands such as `lint:fix`, `eslint --fix`, and `npm run lint -- --fix` are still routed as recommendations.
- Session telemetry is process-global while some sidecar/reporting data is project-scoped.
- `ctx_fetch_run` can still be truncated by adapter output budgets after it builds a large raw preview.
- `fetchRunArtifact` run-id matching is too loose and exact run-id recovery is capped to the newest 200 artifacts.
- OpenClaw bridge stubs expose schemas that look executable but currently redirect instead of honoring params.
- Network sandbox deny and byte-accounting code is not a complete security boundary and should be documented or hardened accordingly.
- `ctx_cache` approved execution inherits MCP server stdin.
- Markdown chunking has avoidable O(n squared) paths for large generated markdown.
- Release-critical helpers and manifests have underdeveloped direct test coverage.
- `ctx_fetch_and_index` source labels can expose full URL query strings.
- Timeline/source-scoped search behavior can mislabel or broaden results.
- OpenClaw/Codex generated configs and static docs have drift from runtime behavior.
- CI/release workflows have bundle-staging, dependency-install, audit, secret-scan, and test-result parsing gaps.
- Context Mode's own review ergonomics need task-scoped telemetry, quieter read/search/index outputs, better Windows path handling, and stronger bypass observability.

Stale or partial findings:

- The targeted changed-file test failure appears stale based on the latest known focused and full test runs after the prior fixes.
- `ctx_fetch_run` defaulting to `head` is true, but `preview: "tail"` now exists. Changing the default is a product decision, not a correctness fix by itself.
- OpenClaw schema drift was partly fixed before this pass; the implementation log below records the completed `ctx_search` and `ctx_index` projectDir parity work.

## Non-Goals

- Do not implement real OpenClaw MCP execution behind bridge stubs in this fix set.
- Do not change `ctx_fetch_run` default preview from `head` to `tail` unless a product decision is made.
- Do not remove context-mode response budgets; make large preview handling budget-aware instead.
- Do not broaden filesystem access or weaken deny-policy behavior to make cross-project workflows easier.

## Implementation Slices

### P0 - Effective Project Security

Create a single effective-project resolution path and use it before any security-sensitive checks.

Required behavior:

- Resolve and canonicalize the effective project root once per request.
- Reject untrusted `projectDir` overrides by default. Accept only a documented allowlist, a project-contained path, or an explicit trusted-caller environment gate.
- Resolve `cwd` against the effective project root and reject paths outside that root.
- Use that root for bash deny policies, non-shell deny policies, file deny patterns, and path evaluation.
- For `ctx_read`, resolve the requested path against `input.projectDir` before file deny evaluation.
- Read bash deny policies through the cross-adapter project resolver rather than `CLAUDE_PROJECT_DIR`.
- Keep existing default-project behavior when no `projectDir` is provided.

Acceptance tests:

- Repo A and repo B have different `.claude/settings*.json` deny rules.
- An untrusted absolute `projectDir` outside the allowed roots is rejected.
- A `cwd` outside the effective project root is rejected.
- A `ctx_execute` call targeting repo B is denied by repo B policy even if the process default is repo A.
- A `ctx_batch_execute` call targeting repo B is denied by repo B policy.
- A `ctx_read` call targeting repo B evaluates repo B file deny rules after path resolution.
- A non-Claude adapter still loads and applies deny policies.
- A no-override call keeps existing default-project behavior.

### P0 - Project-Scoped Store Isolation

Replace the singleton content store with project/store keyed instances.

Required behavior:

- Store instances are keyed by resolved project root or resolved DB path.
- `ctx_search`, `ctx_index`, `ctx_fetch_and_index`, and batch indexing all accept and honor `projectDir`.
- Existing file-backed source refreshes use the same project root that owns the store.
- Search results from project A do not include content indexed only under project B.

Acceptance tests:

- Initialize project A store, index unique A content, then index unique B content under project B.
- Searching project A does not find B content.
- Searching project B does not find A content.
- `ctx_gain` and sidecar attribution identify the project used for the report.

### P0 - Indexing Privacy And Auto-Refresh Safety

Keep indexed content redacted, project-scoped, and source-scoped across initial indexing, refresh, fetch, and timeline search.

Required behavior:

- Move redaction into the store or provide a mandatory redaction callback for every file-backed refresh path.
- Store and compare content hashes consistently after redaction, or keep separate raw-hash and stored-hash fields with clear semantics.
- Preserve attribution when stale-source refresh re-indexes changed file content.
- Restrict session-event auto-indexing to the effective project's expected events file or validated project hash.
- Do not delete another project's session event file from a shared sessions directory.
- Separate full URL cache identity from user-visible/source labels; hash the full URL for identity and store/display a sanitized label.
- Include session/event attribution in ContentStore search rows or label persistent store hits accurately in timeline mode.
- Escape SQL `LIKE` wildcards in `ctx_search(source)` or add exact source matching for caller-provided source labels.

Acceptance tests:

- A file containing a secret is redacted on initial `ctx_index(path)` and remains redacted after the file changes and auto-refresh runs.
- Auto-refresh preserves session attribution or explicitly labels refreshed content attribution as unavailable.
- Project A store does not ingest or delete Project B `*-events.md` files from a shared sessions directory.
- A signed URL or token-bearing query string is not returned in `ctx_fetch_and_index` labels or `ctx_search(source)` hints.
- Timeline search distinguishes current-session ContentStore hits from persistent prior-session hits.
- `ctx_search(source: "foo%")` does not match unrelated `fooX` sources unless wildcard behavior is explicitly requested.

### P0 - Insight And Tool Path Safety

Treat `ctx_insight` and experimental file-scanning tools as security-sensitive filesystem/process surfaces.

Required behavior:

- Keep `ctx_insight` cache, copied source, dependency install, build, and cleanup under a trusted context-mode data directory.
- Treat `sessionDir` and `contentDir` overrides as read-only data roots; validate or allowlist them before use.
- Do not derive cleanup/write locations from caller-controlled `sessionDir`.
- Do not kill a process by port alone. Only stop a tracked `ctx_insight` child PID, or verify process identity and a dashboard sentinel.
- Route experimental `ctx_guard scan-file` through the same project-root, realpath, deny-policy, and sensitive-path checks used by `ctx_read`.
- Keep `ctx_guard includePreview` off by default and project-contained.

Acceptance tests:

- `ctx_insight({ sessionDir })` cannot create, install dependencies, build, or delete outside trusted context-mode cache roots.
- `ctx_insight({ port })` does not kill an unrelated process listening on the chosen port.
- A stale dashboard owned by the current context-mode process can still be replaced safely.
- `ctx_guard({ mode: "scan-file", path: outsideProject })` is rejected unless an explicit trusted-admin gate is enabled.
- `ctx_guard` applies Read deny policy before returning previews or finding metadata for file scans.

### P0 - Production Dependency Audit

Resolve or document the current production audit advisories.

Required behavior:

- Prefer upgrading `@modelcontextprotocol/sdk` if a patched dependency graph exists.
- If a safe upgrade is not available, use targeted overrides only after compatibility testing.
- If an advisory is accepted temporarily, document exploitability assumptions and an owner-visible follow-up.

Acceptance tests:

- `npm audit --omit=dev` is clean, or the remaining advisories are explicitly documented with rationale.
- MCP integration tests still pass after dependency changes.

### P1 - ProjectDir Schema Parity

Make project override support consistent across stable tools.

Required behavior:

- Add `projectDir` to `ctx_execute_file`, `ctx_index`, and `ctx_search` schemas and handlers.
- Update OpenClaw adapter metadata to match server schemas.
- Update docs and AGENTS guidance for explicit project targeting.

Acceptance tests:

- Schema parity tests compare server and OpenClaw metadata for stable tools.
- `ctx_index({ projectDir })` and `ctx_search({ projectDir })` round-trip against the intended project store.
- `ctx_execute_file({ projectDir })` resolves and checks files against the target project.

### P1 - Fetch-Run Hardening And Recovery

Harden sidecar retrieval and make long-log recovery reliable.

Required behavior:

- Reject symlinked metadata and raw files.
- Realpath metadata/raw targets before reading and assert the final path remains inside the artifact root.
- Exact `runId` lookup must not be limited to the latest 200 artifacts.
- Match explicit `runId` requests only against `metadata.runId`, require a minimum prefix length, and reject ambiguous prefixes.
- Remove artifact-directory basename suffix matching.
- Rewrite cleanup byte-cap handling as a single-pass sorted deletion loop and decide whether a lockfile is needed for multi-process writers.
- `ctx_fetch_run({ raw: true, preview: "tail" })` should preserve final summaries within the adapter response budget.
- Explicit `maxBytes` should not promise more output than the adapter can return.
- Label full raw output as raw, not preview, when the artifact is not truncated.

Acceptance tests:

- A symlinked `raw.log` outside the artifact root is rejected.
- An exact `runId` older than 200 newer artifacts is still fetchable.
- A short or ambiguous run-id prefix is rejected.
- A slug substring does not match an unrelated artifact.
- Cleanup preserves pinned artifacts and settles byte totals under a small cap.
- Tail preview includes the final marker line for long logs.
- Oversized preview responses report truncation clearly and keep the useful tail when tail preview is requested.
- Untruncated raw artifact output uses a `redacted raw` label without a preview window suffix.

### P1 - Router Safety For Mutating Commands

Treat write-capable lint and formatter commands as side-effecting.

Required behavior:

- Detect script names ending in `:fix` or containing clear write intent.
- Detect flags such as `--fix`, `--write`, formatter write modes, and common mutation aliases.
- Return classify-only or a higher-risk recommendation unless the user explicitly requested mutation.
- Preserve current recommendations for read-only lint/test/build commands.

Acceptance tests:

- `npm run lint`, `npm run lint -- --reporter=line`, and ordinary read-only lint commands still route normally.
- `npm run lint:fix`, `npm run lint -- --fix`, `npx eslint src --fix`, and `npx prettier . --write` are not low-risk no-side-effect recommendations.

### P1 - OpenClaw Bridge Contract

Make OpenClaw bridge behavior match what its registered schemas imply.

Required behavior:

- Add `isError: true` to OpenClaw `safe()` catch results.
- Either route bridge tools to real MCP handlers or remove/rename params that the bridge cannot honor.
- If bridge tools remain stubs, every tool description and runtime response must state that params are not executed.
- Add schema/runtime contract coverage for advertised params such as `projectDir`, `cwd`, `preview`, `parser`, and `intent`.
- Add a `content`-or-`path` contract to `ctx_index` metadata if the OpenClaw schema continues exposing it.
- Key OpenClaw plugin DB and command state by project/session instead of module-level latest refs.
- Align checked-in Codex sample hooks with the adapter matcher and packaged plugin hooks.
- Align OpenClaw hook constants/generator with runtime lifecycle names, or clearly mark colon hook names as legacy/generic only.
- Correct OpenClaw compaction docs/diagnostics to say context-mode registers a context engine but host compaction remains owner.
- Generate static OpenClaw AGENTS/docs tool examples from the same tool-naming helper used by runtime routing.
- Decide and test whether OpenClaw manifests should include experimental bridge tools when experimental mode is enabled.

Acceptance tests:

- A thrown OpenClaw handler returns `isError: true`.
- Calling a bridge stub with non-empty advertised params produces an explicit stub warning, or the params are honored by real handlers.
- `ctx_index` OpenClaw schema rejects requests with neither `content` nor `path`.
- Registering two OpenClaw sessions/projects does not make `/ctx-stats` or session DB writes read from the latest unrelated session.
- `configs/codex/hooks.json`, `.codex-plugin/hooks.json`, and `PRE_TOOL_USE_MATCHER_PATTERN` stay in parity.
- Generated OpenClaw hook names match the plugin's actual `api.on()` lifecycle names.
- OpenClaw docs and diagnostics agree with runtime `ownsCompaction: false`.

### P1 - Sandbox Network Truth And Metrics

Make network blocking and byte accounting claims match real enforcement.

Required behavior:

- Document `CONTEXT_MODE_SANDBOX_NETWORK=deny` as opt-in defense-in-depth unless OS-level isolation is added.
- If keeping stronger claims, block obvious JS/Python escape paths such as worker threads and child-process shellouts while network deny is active.
- Extend JS byte accounting beyond fetch/http/https or state clearly that http2/raw socket traffic is not counted.

Acceptance tests:

- JS network deny covers fetch, http/https, worker-created fetch, and child-process network attempts or documents unsupported paths.
- Python network deny covers socket-based requests and subprocess network attempts or documents unsupported paths.
- Network byte accounting tests name the protocols that are counted and not counted.

### P1 - Task Cache Safety And Coverage

Make `ctx_cache` execution safe for MCP stdio transports and cover the cache behavior directly.

Required behavior:

- Change approved task execution stdin from inherited to ignored.
- Keep stdout/stderr captured and redacted before cache writes.
- Keep cache execution limited to the approved command family.
- Add direct tests for cache miss, cache hit, bypass, guard-blocked output, oversized entry handling, and stdin behavior.

Acceptance tests:

- `executeApproved` or its public path uses `stdio[0] === "ignore"`.
- Non-approved commands return bypass and do not execute.
- First approved run writes a redacted cache entry; second run returns a hit.
- Guard-blocked output produces a miss with a `cache-output-blocked-by-guard` reason and writes no entry.
- Entries larger than the configured cap return `cache-entry-too-large` and write no entry.

### P1 - Markdown Chunking Performance And Correctness

Keep markdown chunking bounded without pathological CPU on large generated reports.

Required behavior:

- Track current chunk byte length incrementally instead of rebuilding joined strings for every unit.
- Split long non-code lines with incremental byte accounting instead of re-encoding `segment + char` on every character.
- Preserve the intentional behavior for oversized fenced code blocks, but document/test that exception.
- Support valid closing fences with at least as many backticks as the opener.

Acceptance tests:

- Large generated markdown, including a 5 MB long-line case, indexes under a fixed performance budget appropriate for CI.
- Oversized non-code prose chunks stay within the configured cap.
- Oversized fenced code block behavior is explicitly asserted.
- Closing fences longer than the opening fence are recognized.

### P1 - Store/Search Performance

Prevent ordinary searches from scaling with every file-backed source in the persistent store.

Required behavior:

- Avoid synchronously statting all file-backed sources before every search.
- Use a refresh TTL, dirty-source queue, source-scoped refresh, or explicit refresh mode.
- Preserve stale-source correctness for changed indexed files without making every query O(number of file-backed sources).

Acceptance tests:

- Searching a store with many file-backed sources does not stat every source on every query.
- Source-scoped search refreshes only relevant source candidates when possible.
- Changed file-backed content is eventually refreshed under the chosen policy.

### P2 - Telemetry Scope

Make savings and bypass reports easier to trust in multi-project sessions.

Required behavior:

- Either key stats by `{ sessionId, projectDir }` or label reports clearly as process-global plus project-scoped sidecars.
- `ctx_gain` and `ctx_discover` should make task/project scope explicit.
- Preserve host `sessionId` attribution when a validated project override is active.
- Add task/run labels or scoped counters so closeout reports can distinguish "this task" from broad MCP process totals.
- Make bypass observability explicit: separate observed managed-tool usage from native-tool bypass categories that are not measurable for the current adapter.

Acceptance tests:

- A mixed-project session reports which counters are global and which are project-scoped.
- Project-specific sidecar bytes do not imply all returned bytes came from the same project.
- Indexed chunks written under a project override still carry the host session attribution.
- A task-scoped gain/discover report excludes unrelated earlier session activity or labels it separately.
- `ctx_discover` output states which bypass classes are observable for the active adapter.

### P2 - Sidecar Byte Cap Semantics

Make the per-run cap strict or rename it as approximate.

Required behavior:

- Preferred: include truncation marker bytes in the stored-byte budget.
- Acceptable alternative: rename/document the setting as an approximate cap.

Acceptance tests:

- If strict, `metadata.storedBytes <= maxRunBytes` for deterministic tiny caps.
- If approximate, tests and docs state the marker can exceed the content budget.

### P2 - Low-Priority Cleanup

Address the remaining lower-severity review items after the safety and isolation work.

Required behavior:

- Baseline intentional fake-secret fixtures so real secret-scan failures are visible.
- Make OpenClaw bridge stubs clearly say they are bridge stubs and do not execute directly.
- Clarify markdown chunking behavior for oversized fenced code blocks.
- Improve artifact listing resilience around orphaned run directories and concurrent cleanup/write races.
- Clean up `CM_FS_PRELOAD` temp files on normal process exit.
- Document or harden Windows ACL behavior for sidecar artifacts.
- Memoize hot-path platform detection in `getProjectDir()` without breaking adapter freshness.
- Add timeout fallback to macOS OS temp-dir detection.
- Remove misleading WAL PID parsing comments or implement the behavior described.
- Clean up atomic-write temp files when `renameSync` fails.
- Point docs/specs at `filters/pipeline.ts` for redaction logic instead of the `artifacts/redaction.ts` facade when triage needs implementation details.
- Consider preserving quote style in generic secret assignment redaction.
- Consider keeping the last 25 failure-focused lines, or a head/tail split, when stderr has many matches.
- Consider replacing `sliceUtf8TailBytes` with a lower-allocation implementation for large strings.
- Normalize supply-chain script path labels using resolved relative paths rather than string-prefix replacement.
- Add quieter `ctx_read` modes for large reviews, such as top-level headings only, exported symbols with line ranges, imports plus exports, or slice-with-containing-symbol.
- Add compact inventories for `ctx_batch_execute` when a run indexes many sections.
- Improve `ctx_search` source/project UX by showing active source/project labels and warning when results come from a different project than the requested `projectDir`.
- Improve `ctx_index` chunking/indexing of generated reports so follow-up searches return precise sections instead of broad community blobs.
- Smooth Windows shell/path execution for absolute paths, drive letters, quoting, and PowerShell-vs-shell syntax.
- Make `ctx_route` compound-command guidance easier to act on, such as returning split command suggestions.
- Consider making `ctx_fetch_run` suggest `preview: "tail"` for test/build/log sidecars or show small head and tail snippets by default.
- Track Mono/Mochi missing prompt-marker warnings from `ctx_doctor` as OpenClaw/Codex home hygiene.

Acceptance tests:

- Secret scan output has no noisy intentional fixtures without an allowlist explanation.
- OpenClaw stub descriptions are unambiguous.
- Markdown chunk tests cover oversized prose splitting and oversized code-fence preservation.
- Artifact listing ignores or cleans orphaned partial runs without throwing.
- Startup/shutdown tests do not leave per-PID preload files behind when the process exits normally.
- Windows sidecar permission limitations are covered by docs or platform-specific hardening tests.
- Atomic write failure tests assert leaked `.tmp` files are removed.
- Huge generated docs can be inspected through a compact `ctx_read` mode without hundreds of repetitive headings.
- `ctx_batch_execute` returns a compact section inventory when section count exceeds a threshold.
- Windows absolute-path shell commands are normalized or produce actionable diagnostics.

### P1 - Release Gates And Test Backfill

Make release-critical helpers and quarantine manifests less fragile.

Required behavior:

- Add direct tests for `ctx_upgrade` default-off behavior, enabled-without-bundle behavior, and enabled-with-bundle command generation.
- Add tests for plugin-cache integrity helper loading and missing sibling reporting.
- Add tests for bundle assertion and asymmetric-drift scripts using fixtures.
- Add tests for `heal-better-sqlite3.mjs` platform/environment detection that is likely to regress.
- Expand OpenClaw schema tests into full table coverage and add runtime/stub behavior tests.
- Stagger skip-manifest expiries and assign meaningful owners instead of a single mass-expiry date.
- Align `scripts/pre-commit.mjs` with the intended local release gate subset, with an explicit escape hatch.
- Stage every generated bundle in `.github/workflows/bundle.yml`, including security and rewrite-registry hook bundles.
- Run bundle and asymmetric-drift assertions in the bundle workflow after bundling.
- Make CI test parsing verify zero failed suites/tests and only suppress explicitly matched known cleanup failures.
- Use `npm ci` in CI/bundle/E2E workflows.
- Add a real production dependency audit gate and a real secret scan with a checked-in allowlist/baseline.

Acceptance tests:

- `tests/tools/upgrade.test.ts` covers disabled and enabled paths.
- `tests/util/plugin-cache-integrity.test.ts` covers success and missing-helper failure.
- `tests/scripts/assert-bundle.test.ts` and `tests/scripts/assert-asymmetric-drift.test.ts` cover pass/fail fixtures.
- `tests/scripts/heal-better-sqlite3.test.ts` covers conda, safe Python resolution, and Visual Studio year detection behavior.
- Skip-audit strict mode does not have a synchronized owner/expiry cliff.
- Precommit either runs the documented fast gate subset or the docs accurately state that broader gates are CI/release-only.
- Bundle workflow stages the same bundle set as `npm run assert-bundle`.
- CI fails when Vitest exits nonzero for any reason other than the explicitly allowlisted native cleanup condition.
- CI and release verification fail on production audit regressions and unexpected secrets.
- Workflow dependency installation is lockfile-reproducible.

## Implementation Order

1. Effective project security.
2. Project-scoped store isolation.
3. Indexing privacy and auto-refresh safety.
4. Insight and tool path safety.
5. Schema parity for `projectDir`.
6. OpenClaw bridge contract.
7. Fetch-run hardening and recovery.
8. Task cache safety and coverage.
9. Markdown chunking performance and correctness.
10. Store/search performance.
11. Router safety for mutating commands.
12. Sandbox network truth and metrics.
13. Dependency audit remediation.
14. Release gates and test backfill.
15. Telemetry scope and lower-priority cleanup.
16. Documentation, OpenClaw metadata, AGENTS guidance, and final validation.

## Verification Gates

Run these before closeout:

- Focused tests for each changed subsystem.
- `npm run typecheck` or the repo-equivalent TypeScript check.
- `npm test`.
- `npm run build`.
- `npm run precommit` if available and not duplicative.
- `npm audit --omit=dev`.
- `ctx_doctor`.
- `ctx_gain`.
- `ctx_discover`.

If any gate cannot be run, record the reason in the closeout.

## Subagent Review Plan

Use subagents after implementation, with disjoint responsibilities:

- Security reviewer: effective project root, deny policy behavior, symlink artifact handling, dependency audit.
- Isolation/schema reviewer: store keying, indexing redaction, session-event isolation, `projectDir` schema parity, OpenClaw metadata.
- Runtime reviewer: network sandbox claims, cwd containment, `ctx_insight` process/path behavior, task-cache stdin behavior, run-store cleanup, Windows sidecar permission behavior.
- Verification reviewer: focused tests, workflow gates, bundle staging, stale generated artifacts, docs accuracy.

## Additional Review Intake

When the next two reviews are provided:

1. Add each finding to this spec only after checking current code or current test output.
2. Mark each finding as valid, stale, partially valid, or unverified.
3. Merge duplicates into the existing implementation slices instead of creating parallel tasks.
4. Escalate priority only when the finding changes security, correctness, privacy, or release readiness.
5. Add one acceptance test or explicit rationale for every valid finding.

## Implementation Log - 2026-05-19

Completed in this pass:

- Hardened `projectDir` and `cwd` handling for MCP tool inputs:
  - Untrusted `projectDir` overrides now require project containment, `CONTEXT_MODE_ALLOWED_PROJECT_DIRS`, or `CONTEXT_MODE_ALLOW_PROJECT_OVERRIDE=1`.
  - `cwd` must resolve inside the effective project root unless `CONTEXT_MODE_ALLOW_OUTSIDE_CWD=1`.
  - Windows/MSYS-style `/c/...` paths are normalized before validation.
  - Trusted embedded/native plugin calls can pass an explicit trusted project override without weakening MCP caller validation.
- Switched bash and non-shell deny checks to the effective project resolver instead of `CLAUDE_PROJECT_DIR`.
- Fixed `ctx_read` ordering so explicit `projectDir` is resolved before file deny checks.
- Fixed Windows/MSYS-style absolute paths so the same normalized path is used for both deny checks and the actual `ctx_read`/`ctx_index` operation.
- Canonicalized directory validation through real paths so symlinks/junctions inside an allowed root cannot escape the effective project boundary.
- Keyed `ContentStore` instances by resolved store path instead of one process-global singleton.
- Added `projectDir` support for `ctx_execute_file`, `ctx_index`, `ctx_search`, `ctx_fetch_and_index`, and `ctx_fetch_run` wiring.
- Kept file-backed indexing redacted on initial index and stale-source refresh.
- Advanced stale-source refresh metadata when only redacted values change and the redacted content hash stays the same, preventing repeat reopen/re-redact loops.
- Escaped `%`, `_`, and `\` in source-scoped search filters.
- Restricted session-event auto-indexing to the current project/session path.
- Hardened `ctx_insight` path/port handling so caller-provided data dirs are read-only inputs and dashboard restarts only stop the tracked child.
- Routed `ctx_guard scan-file` through realpath, project containment, and Read deny checks.
- Sanitized `ctx_fetch_and_index` visible source labels so full URL query strings are not displayed as labels.
- Hardened run sidecars:
  - Reject symlinked or realpath-escaping metadata/raw artifacts.
  - Reject symlinked day/artifact directories before following metadata.
  - Fetch exact run ids beyond the latest 200 artifacts.
  - Require run-id prefixes to be at least 6 chars and uniquely match `metadata.runId`.
  - Removed artifact-directory suffix matching.
  - Made per-run truncation include marker bytes in the byte cap.
  - Preserved UTF-8 tail previews without allocating `Array.from(text)`.
  - Cleaned atomic-write temp files on failed rename.
- Fixed `ctx_fetch_run` full raw label so untruncated output is `redacted raw`, not `redacted raw preview`.
- Made mutating lint/formatter commands such as `lint:fix`, `--fix`, and `--write` stop matching the low-risk lint route.
- Made OpenClaw bridge stubs explicit in every description and runtime response, and added `isError: true` for bridge handler failures.
- Aligned OpenClaw stable schema metadata for the newly supported `projectDir` fields.
- Changed approved `ctx_cache` execution stdin from inherited to ignored.
- Improved markdown chunking:
  - Incremental byte accounting for chunk assembly and long non-code line splitting.
  - Valid closing fences may contain more backticks than the opener.
- Added small cleanup fixes:
  - macOS temp-dir helper subprocess has a timeout.
  - stale content DB cleanup comments now match the mtime-based WAL behavior.
  - failure-focused filtering keeps the tail of long failure streams.
  - generic secret assignment redaction preserves quote style.

Regression coverage added or extended:

- Project security/static coverage in `tests/core/deny-policy.test.ts`.
- Sidecar hardening and byte-cap tests in `tests/artifacts/run-store.test.ts`.
- Fetch-run raw-label tests in `tests/tools/route-fetch-run.test.ts`.
- Execute/batch projectDir allowlist tests in `tests/tools/execute-sidecar-integration.test.ts`.
- OpenClaw schema/stub tests in `tests/plugins/openclaw-tool-schema.test.ts`.
- Guard scan-file tests in `tests/guard/scanner.test.ts`.
- Store redaction/source-filter/chunking tests in `tests/stale-detection.test.ts` and `tests/store.test.ts`.
- Cache stdin regression in `tests/cache/explain.test.ts`.
- Filter pipeline tail/quote regression tests in `tests/filters/pipeline.test.ts`.
- Windows/MSYS path and symlink/junction escape regressions in `tests/tools/read.test.ts`, `tests/core/server.test.ts`, and `tests/tools/execute-sidecar-integration.test.ts`.

Subagent/self-review closeout:

- Subagent team review accepted and fixed these post-implementation findings:
  - `ctx_read`/`ctx_index` normalized MSYS paths for policy checks but not the actual operation.
  - `projectDir`/`cwd` validation needed canonical realpath comparison to block symlink/junction escape.
  - Run-store listing needed to reject symlinked day/artifact directories before trusting metadata/raw paths.
  - Stale redacted refresh needed to update refresh metadata when the redacted content hash is unchanged.
  - This spec needed stale wording cleanup for audit and `projectDir` parity findings.
- No unresolved blocking findings remained after the targeted fixes and self-review pass.

Final verification:

- `npm.cmd run build` - passed.
- `npx.cmd tsc --noEmit` - passed.
- Targeted Vitest set for changed subsystems - passed: 214 passed, 10 skipped across 6 files.
- `npm.cmd test` - passed: 100 test files passed, 20 skipped; 1707 tests passed, 682 skipped.
- `npm.cmd run precommit` - passed.
- `npm.cmd run assert-bundle` - passed.
- `npm.cmd audit --omit=dev` - passed.
- `git diff --check` - passed.
- Standalone `context-mode doctor` - passed, including Codex PreToolUse after updating `C:\Users\chris\.codex\hooks.json` while preserving Serena hook entries.
- MCP `ctx_doctor` in the already-running server process still reports the old PreToolUse failure, while standalone doctor passes against the same file; restart the MCP server/session before treating that stale diagnostic as current.
- `ctx_gain` - session-scoped report: 3.28MB returned, 306.86MB kept out, 99% savings, 247 sidecars.
- `ctx_discover` - no observable bypasses; native-tool bypass categories remain not measurable without adapter event capture.

Known deferred or partially covered spec items:

- Task-local `ctx_gain`/`ctx_discover` scoping is still deferred; current reports remain session/process scoped.
- Store search still refreshes all file-backed sources synchronously before search; privacy is fixed, but the performance policy is not.
- Network sandbox enforcement remains defense-in-depth; broader worker/subprocess/http2/raw-socket hardening and docs are not fully completed in this pass.
- Release-gate backfill for `ctx_upgrade`, plugin-cache integrity, bundle/asymmetric-drift fixtures, skip-manifest ownership/expiry staggering, CI `npm ci`, secret-scan baselines, and precommit gate expansion remains deferred.
- OpenClaw per-project/module-level slash-command state keying and generated docs/hook-name drift remain deferred.
- Windows ACL hardening for sidecar artifacts is documented as a remaining platform limitation, not changed in code.
