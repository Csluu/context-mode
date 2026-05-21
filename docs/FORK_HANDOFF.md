# Context-Mode Fork Handoff

Date: 2026-05-17
Branch observed: `tier2/refactor`
Purpose: give the next AI agent enough state to continue without rediscovering the project.

## One-Sentence State

This fork has implemented the first major RTK-inspired slice: route explainability, parser/filter plumbing, redacted sidecars, safer file reads, savings analytics, bypass discovery, output budgets, guard/eval/release gates, and experimental trace/diff/cache surfaces.

## Current Goal

Make the fork reliable enough to use as a private daily-driver context firewall for AI coding agents, especially Codex/OpenClaw-style workflows where native tool reads, broad shell output, and long test/diff logs can waste large amounts of context.

The immediate work is not to add more public tool surface. The immediate work is live testing, validation, and tightening anything that breaks under real agent use.

## What Was Done

### Routing and rewrite registry

Implemented central command classification and route decisions:

- `src/routing/command-classifier.ts`
- `src/routing/rewrite-registry.ts`
- `src/routing/command-coverage.ts`
- `src/tools/route.ts`
- `hooks/core/routing.mjs`

The router can explain noisy commands before execution. Hook rewrite exists but remains opt-in and allowlist-bound.

Key policy:

- `recommend` mode classifies only.
- `rewrite` mode requires explicit env opt-in.
- Interactive, stdin, TTY, watch, install, deploy, and long-running commands should not be auto-rewritten by default.

### Parser/filter pipeline

Implemented reusable parser/filter contracts:

- `src/parsers/registry.ts`
- `src/parsers/types.ts`
- `src/filters/pipeline.ts`
- `src/filters/types.ts`

This is the foundation for failure-focused test output, compact diffs/search output, JSON-first parsing, and fail-open parser behavior.

### Sidecar artifacts

Implemented redacted raw-output sidecars:

- `src/artifacts/run-store.ts`
- `src/artifacts/redaction.ts`
- `src/tools/fetch-run.ts`
- executor integration in `src/executor.ts`

Sidecars let agents retrieve redacted raw output later with `ctx_fetch_run` instead of rerunning commands and burning more context.

### `ctx_read`

Implemented safe file-read modes:

- `auto`
- `map`
- `outline`
- `symbols`
- `slice`
- `full`

Files:

- `src/read/ctx-read.ts`
- `src/tools/read.ts`

Behavior:

- Large full reads require a reason.
- Repeated unchanged reads collapse.
- Binary-ish files are blocked.
- Provider metadata is returned.
- TypeScript compiler provider exists with heuristic fallback.

### Analytics and discovery

Implemented savings and missed-savings tools:

- `src/tools/gain.ts`
- `src/tools/discover.ts`
- `src/session/telemetry-summary.ts`

`ctx_gain` answers "how much did this save?"
`ctx_discover` answers "what bypassed context-mode or still looks noisy?"

This is the measurement loop that proves whether the fork works in real sessions.

### Output budgets

Added adapter output budget controls:

- `src/adapters/output-budget.ts`
- tests in `tests/adapters/output-budget.test.ts`

This prevents route/fetch/search responses from growing without bounds.

### Config and doctor

Added layered config and richer diagnostics:

- `src/config/context-mode-config.ts`
- `src/tools/doctor.ts`

`ctx_doctor` now reports router/config/tier information, including JSON output.
`ctx_diff` is now a stable default tool for git-text diff inventory, optional Difftastic-style summaries, ref ranges, and raw sidecars.

### Experimental features

Implemented but kept hidden by default:

- `ctx_guard`: scanner for secrets, prompt-injection markers, unsafe terminal controls.
- `ctx_eval`: fixture harness for parser/router/redaction/no-critical-omission correctness.
- `ctx_trace`: local trace summary and why-big analysis.
- `ctx_cache`: explain cache eligibility and run an explicit `tsc --noEmit` serving canary.

These remain gated by:

```bash
CTX_MODE_EXPERIMENTAL=1
CONTEXT_MODE_EXPERIMENTAL=1
```

### Release and validation gates

Added scripts:

- `scripts/skip-audit.mjs`
- `scripts/supply-chain-check.mjs`
- `scripts/release-candidate-reports.mjs`
- `scripts/release-package.mjs`
- `scripts/release-checksums.mjs`
- `scripts/release-provenance.mjs`

Added validation docs:

- `docs/rtk-inspired-context-mode-spec.md`
- `docs/rtk-spec-completion-audit.md`
- `docs/rtk-spec-validation-plan.md`
- `docs/AGENT_PROJECT_OVERVIEW.md`
- `docs/FORK_HANDOFF.md`

Added `.gitignore` exceptions so those docs are not ignored by `/docs/*`.

### Feedback hotfixes applied

- Removed tracked `.openclaw-install*.log` files and ignored future OpenClaw install logs.
- CI doctor now fails the workflow instead of using `continue-on-error: true`.
- MCP `ctx_upgrade` and direct `context-mode upgrade` are disabled by default unless `CONTEXT_MODE_ALLOW_UNPINNED_UPGRADE=1` is explicitly set; the removed inline fallback no longer clones mutable GitHub state.
- Startup sibling sweep is now opt-in via `CONTEXT_MODE_STARTUP_SWEEP=1`, not default-on.
- Tool responses and FTS indexing paths now redact known secrets before chat return or persistence.
- `ctx_read` now receives the server Read deny-policy hook before calling `ctxRead`.
- Experimental `ctx_cache run` refuses bypass/non-canonical commands instead of executing them.
- Telemetry emitters now accept an explicit session id, and server call sites capture it before scheduling async writes.
- Experimental MCP tools unlock only with exact `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`.

### Agent instruction updates

Updated platform instruction/config files so agents know about:

- stable tools: `ctx_read`, `ctx_route`, `ctx_fetch_run`, `ctx_gain`, `ctx_discover`, `ctx_diff`
- experimental tools hidden by default
- Graphify first for repo-wide architecture
- Serena for exact symbol/reference navigation
- context-mode for broad/noisy output
- shell for exact edits, tests, small reads, and git writes

Important files:

- `configs/codex/AGENTS.md`
- `configs/openclaw/AGENTS.md`
- `configs/*`
- `CLAUDE.md`
- `skills/context-mode/SKILL.md`
- `skills/ctx-stats/SKILL.md`

## Current Validation Evidence

Latest observed run on 2026-05-17:

```text
npm test
93 passed | 21 skipped test files
1593 passed | 684 skipped tests
build passed
assert-bundle passed
assert-asymmetric-drift passed
```

Additional gates run:

```text
npm run benchmark:check
passed, 87% overall savings

npm run eval:fast
passed, 8 passed, 0 failed, 0 missing

npm run guard:fixtures
passed; seeded secrets were blocked as expected

npm run release:reports
passed; emitted candidate report artifacts

npm run skip:audit:strict
passed; 100 skip markers, 0 manifest issues

npm run supply-chain:check
passed; 244 dependencies scanned

git diff --check
passed; only CRLF normalization warnings in config markdown files
```

`npm run release:verify` was not run after the last doc edit because the worktree is dirty. That is expected during development. It should be run only from a clean release candidate because provenance intentionally rejects dirty releases.

## What Is Currently Being Done

Current stage: documentation, handoff, and live-testing readiness.

The project is past the first implementation slice. The next work should be:

1. Use this fork live in Codex/OpenClaw.
2. Watch `ctx_gain` and `ctx_discover`.
3. Confirm agents actually choose `ctx_read`, `ctx_route`, and `ctx_fetch_run`.
4. Fix real bypasses or confusing tool behavior.
5. Avoid expanding the default MCP surface unless the measurement loop proves the need.

## What Still Matters

### High-value next checks

1. Live adapter testing in the real target environments.
2. Confirm Codex and OpenClaw hooks install into the exact directories the user actually runs.
3. Confirm native Read/Grep/Glob bypasses are visible enough to diagnose, even if not fully preventable.
4. Confirm `ctx_gain` reports the session the user expects, not confusing all-time or unrelated historical totals.
5. Confirm `ctx_fetch_run` raw previews are useful enough that agents stop rerunning commands.
6. Confirm `ctx_read` quality on non-TypeScript repos degrades visibly with provider metadata instead of silently pretending to be precise.

### Worth doing later

- Tree-sitter or LSP-backed `ctx_read` providers.
- Stronger semantic diff mode beyond current git-text inventory.
- Broader task cache serving after more cache-key and safety proof.
- Richer trace UI or `ctx_gain --trace` integration.
- Adapter-specific live self-tests in CI for any platform with mutation hooks.
- Better `ctx_stats`/`ctx_gain` session scoping UX.
- Regenerate Graphify output with generated bundles excluded. Current local `graphify-out/graph.json` can report many nodes but zero edges, so do not treat it as architecture evidence until refreshed.

### Probably not worth doing now

- Adding more default MCP tools.
- Making experimental tools stable before real usage proves the contract.
- Turning hook rewrite on by default.
- Broad adapter consolidation purely for code cleanup.
- More refactors that do not improve live agent behavior or safety.

## Critical Risks To Watch

### Native tool bypass

Some agents have native file/search tools that do not pass through shell hooks. Context-mode cannot guarantee savings unless the adapter can observe, deny, or mutate those tool calls.

Watch `ctx_discover` for:

- observable bypass
- unobservable native tool
- instruction-only bypass
- hook missing
- hook present but no mutation
- MCP available but not used

### Tool surface bloat

Every MCP tool schema can cost context. Stable tools should stay limited. Experimental tools are intentionally gated.

Default stable new tools:

- `ctx_read`
- `ctx_route`
- `ctx_fetch_run`
- `ctx_gain`
- `ctx_discover`
- `ctx_diff`

Default hidden experimental tools:

- `ctx_guard`
- `ctx_eval`
- `ctx_trace`
- `ctx_cache`

### Bundle drift

The repo checks in generated bundles. A passing TypeScript build is not enough if bundle files are stale.

Always pay attention to:

- `server.bundle.mjs`
- `cli.bundle.mjs`
- `hooks/session-extract.bundle.mjs`
- `hooks/session-snapshot.bundle.mjs`
- `hooks/session-db.bundle.mjs`
- `hooks/security.bundle.mjs`
- `hooks/rewrite-registry.bundle.mjs`

The build runs `assert-bundle` and `assert-asymmetric-drift`.

### Sidecar privacy

Redaction is best effort. Do not weaken scanner tests. Do not persist raw stdin by default. Be careful with new parser paths that may write sidecars, FTS content, analytics metadata, or traces.

### Rewrite semantics

Hook rewrite must preserve command semantics. Do not rewrite commands if you cannot preserve:

- exit code
- cwd
- environment behavior
- stdout/stderr separation
- timeout behavior
- signal behavior
- stdin behavior
- TTY/interactive behavior
- PATH resolution
- shell dialect behavior
- permission prompts

### Release provenance

Local provenance/checksums exist. Hosted external attestation is not implemented. Do not overstate the trust model.

## How To Start A New Work Session

1. Read `docs/AGENT_PROJECT_OVERVIEW.md`.
2. Read this file.
3. Read `docs/rtk-spec-validation-plan.md`.
4. Check `git status --short`.
5. Check graph freshness:

   ```bash
   git rev-parse HEAD
   ```

   Compare with `graphify-out/GRAPH_REPORT.md`. If stale and architecture work is needed, run `graphify update .`.

6. Run a fast health check:

   ```bash
   npm run typecheck
   npm run eval:fast
   npm run guard:fixtures
   git diff --check
   ```

7. For code changes, run targeted tests first, then `npm test`.

## Testing Matrix For Future Agents

Use this matrix instead of guessing.

| Change type | Minimum tests |
| --- | --- |
| Docs only | `git diff --check` |
| Config/instruction docs | JSON parse relevant config files, `git diff --check`, relevant hook/plugin tests |
| TypeScript compile-only change | `npm run typecheck` |
| MCP tool schema or registry | `vitest run tests/tools/registry.test.ts tests/plugins/openclaw.test.ts tests/plugins/openclaw-tool-schema.test.ts && npm run release:reports` |
| `ctx_read` behavior | `vitest run tests/read tests/tools/read.test.ts` |
| Router/rewrite/classifier | `vitest run tests/routing tests/hooks/hook-rewrite.test.ts tests/cli/run-command.test.ts` |
| Hook behavior | `vitest run tests/hooks tests/cli/hook-self-test.test.ts` |
| Executor/sidecar behavior | `vitest run tests/executor.test.ts tests/artifacts tests/tools/execute-sidecar-integration.test.ts` |
| Analytics/session stats | `vitest run tests/session tests/tools/gain.test.ts tests/tools/discover.test.ts` |
| Guard/redaction | `vitest run tests/guard tests/eval && npm run guard:fixtures` |
| Eval harness | `vitest run tests/eval && npm run eval:fast` |
| Release scripts | `vitest run tests/release && npm run supply-chain:check && npm run release:reports` |
| Broad fork readiness | `npm test && npm run benchmark:check && npm run eval:fast && npm run guard:fixtures && npm run skip:audit:strict && npm run supply-chain:check && npm run release:reports` |

## Live Test Script

Use this when testing the fork with an agent:

1. Ask for `ctx doctor`.
2. Ask the agent to inspect a large file without raw reading it. Expected: `ctx_read`.
3. Ask the agent to inspect a noisy command before running it. Expected: `ctx_route`.
4. Run a test or broad diff through context-mode. Expected: compact result and sidecar.
5. Ask for the raw sidecar. Expected: `ctx_fetch_run`, not rerun.
6. Ask "how much did this session save?" Expected: `ctx_gain`.
7. Ask "what bypassed context-mode?" Expected: `ctx_discover`.
8. Confirm the agent does not use experimental tools unless enabled.

Commands to try:

```bash
context-mode route --explain "git diff"
context-mode run -- git status --short
context-mode hook test --adapter codex
```

For MCP-only platforms, use the equivalent MCP tools instead of CLI commands.

## Future Plan

### Phase A: Live hardening

- Test in actual Codex/OpenClaw sessions.
- Collect `ctx_gain`/`ctx_discover` output after real work.
- Fix confusing session scoping in stats/gain if it appears during live use.
- Improve docs only when live behavior proves agents misunderstand the rules.

### Phase B: Better code navigation

- Add Tree-sitter provider interface implementation.
- Add LSP/provider fallback for common languages.
- Consider Serena-compatible provider only after local providers are stable.

### Phase C: Semantic diff and review quality

- Upgrade `ctx_diff` beyond text inventory.
- Preserve raw file inventory while summarizing semantic change groups.
- Add review-focused risk categories and no-critical-omission fixtures.

### Phase D: Cache expansion

- Keep `ctx_cache` experimental until cache keys are proven.
- Add canaries one at a time: `eslint`, `vitest run`, `pytest`, `go test`.
- Never cache install, migration, deploy, watch, or interactive commands by default.

### Phase E: Release polish

- Run `npm run release:verify` on a clean worktree.
- Decide whether private fork needs hosted provenance or only local artifacts.
- Keep docs, bundles, generated schemas, and validation reports in sync.

## Handoff Verdict

The fork is ready for controlled live testing. It is not "done forever"; the next useful work is to observe whether agents actually route through the new stable tools, whether stats/gain are understandable in real sessions, and whether any sidecar/read/router behavior causes friction.

Do not add more public MCP tools until real usage shows a missing stable workflow. The default tool surface is intentionally small.
