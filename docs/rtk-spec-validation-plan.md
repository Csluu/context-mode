# RTK-Inspired Context-Mode: Validation, Verification & Comparison Plan

Date: 2026-05-17
Branch: `tier2/refactor`
Companion docs: [`rtk-inspired-context-mode-spec.md`](./rtk-inspired-context-mode-spec.md), [`rtk-spec-completion-audit.md`](./rtk-spec-completion-audit.md), original baseline [`rtk-inspired-context-mode-spec - Copy.md`](./rtk-inspired-context-mode-spec%20-%20Copy.md)

## 1. Purpose

This document is the verification counterpart to the spec and audit. It answers three questions:

1. **What changed** between the original context-mode and the RTK-inspired refactor on this branch?
2. **How do we prove** each change is correct, safe, and meets the spec's acceptance metrics?
3. **What is the comparison surface** (functional, observability, performance, safety) against the original context-mode so a reviewer can sign off without re-reading 2700 lines of spec?

It is structured so a contributor can execute it top-to-bottom as a release gate.

## 2. Scope of Changes vs. Original Context-Mode

### 2.1 Spec delta (RTK doc vs. its earlier copy)

| Area | Original copy (`Copy.md`) | Updated spec (current) |
|---|---|---|
| Features | 1–12 | 1–17 (+13 Semantic Diff, +14 Local Trace, +15 Deterministic Task Cache, +16 Guard Scanner, +17 Eval Harness) |
| Phases | 0–5 | 0–7 (+Phase 6 Trace/Guard/Diff/Eval Hardening, +Phase 7 Task Cache) |
| Contracts | inline per-feature | adds explicit "Implementation Contract Addendum For Features 13-17" with TS interfaces (`TraceSpanRecord`, `CtxEvalReport`, `ctx_diff`, `ctx_run_cached`, `ctx_guard`) |
| Status section | absent | new "Current Implementation Status" enumerating ~40 shipped items + future-scoped extension points |
| Release gates | basic checklist | adds named candidate artifacts: `adapter-validation-report.json`, `schema-snapshot.json`, `fixture-coverage.json`, `semantic-diff-fixture-report.json`, `task-cache-readiness-report.json`, `release-checklist.md`; SBOM, signed checksums, provenance, license SPDX validation |
| Sources | RTK + a few links | adds Difftastic, OTEL GenAI semconv, Nx/Turborepo/Bazel caching, Gitleaks/Semgrep/Trivy |

977 line-level diffs between the two specs.

### 2.2 Code delta

New module roots introduced by this branch:

```
src/routing/   command-classifier.ts, rewrite-registry.ts, command-coverage.ts, types.ts
src/parsers/   registry.ts, types.ts
src/filters/   pipeline.ts, types.ts
src/read/      ctx-read.ts
src/artifacts/ run-store.ts, redaction.ts
src/config/    context-mode-config.ts
src/cache/     explain.ts
src/diff/      git-text.ts
src/eval/      cli.ts, harness.ts
src/guard/     scanner.ts
src/trace/     summary.ts
src/adapters/  output-budget.ts
src/session/   telemetry-summary.ts (added)
src/tools/     route.ts, fetch-run.ts, read.ts, gain.ts, discover.ts, cache.ts, diff.ts, eval.ts, guard.ts, trace.ts
```

New release/supply-chain scripts:

```
scripts/release-package.mjs       scripts/release-checksums.mjs
scripts/release-provenance.mjs    scripts/release-candidate-reports.mjs
scripts/supply-chain-check.mjs
```

New `package.json` scripts: `eval:fast`, `eval:full`, `guard:fixtures`, `skip:audit`, `skip:audit:strict`, `supply-chain:check`, `benchmark:report`, `release:reports`, `release:package`, `release:checksums`, `release:provenance`, `release:verify`.

### 2.3 New MCP tools (surface comparison)

| Tool | Original CM | New | Purpose |
|---|---|---|---|
| `ctx_execute` / `ctx_execute_file` | ✓ | ✓ (parser opt-in, sidecar, telemetry) | unchanged contract, augmented behavior |
| `ctx_batch_execute` | ✓ | ✓ | unchanged |
| `ctx_search` | ✓ | ✓ | unchanged |
| `ctx_fetch_and_index` | ✓ | ✓ | unchanged |
| `ctx_route` | — | new | passive route explanation |
| `ctx_fetch_run` | — | new | sidecar list / fetch / preview |
| `ctx_read` | — | new | auto/map/outline/slice/symbols/full file reads |
| `ctx_gain` | partial | rewritten | savings + per-tool latency, session/historical |
| `ctx_discover` | — | new | bypass taxonomy + missed-savings |
| `ctx_diff` | — | experimental-gated | git-text inventory, optional Difftastic fallback, risk |
| `ctx_guard` | — | experimental-gated/internal pipeline | secret/redaction scanner |
| `ctx_eval` | — | experimental-gated/CLI gate | fixture-driven correctness harness |
| `ctx_trace` | — | experimental-gated/local only | local span observability |
| `ctx_cache` | — | experimental-gated/CLI canary | deterministic task cache explain + explicit `tsc --noEmit` serving canary |
| `ctx_doctor` | minimal | adds `--json`, router source, tier reporting |

### 2.4 Behavioral delta

- **Hooks**: were recommendation-only. Now: opt-in Bash mutation for a low-risk allowlist gated by `CONTEXT_MODE_ROUTER_MODE=rewrite` / `CONTEXT_MODE_HOOK_REWRITE=1`. Fail-open on parser/router crash.
- **Executor**: now tees stdout/stderr into sidecar before MCP response formatting (`src/executor.ts` `outputCapture`).
- **Sidecars**: redacted, atomic-write, per-run cap, project quota, TTL cleanup, pinning, stale-metadata fail-open, current-run retention under tiny caps.
- **Adapters**: per-adapter output budget manifest (`maxImportantItems`, `maxSearchMatches`, `maxSidecarPreviewBytes`, max returned bytes) enforced in `trackResponse`.
- **Telemetry**: session events extended with route decisions, parser confidence, per-tool latency, adapter/agent rollups.
- **Config**: layered (defaults → project → env), project restrictions, schema in `src/config/context-mode-config.ts`.
- **CLI**: new `context-mode run [--parser <name>] -- <cmd>` and `context-mode hook test --adapter <id>`.

## 3. Acceptance Metric → Evidence Map

Every metric from the spec's "Acceptance Metrics" section, with a concrete verification command.

| Metric | Threshold | Command | Pass file |
|---|---|---|---|
| Returned-byte reduction on noisy commands | ≥80% | `npm run benchmark:check` | `build/benchmark-report.json` |
| Secret-fixture leaks | 0 | `npm run guard:fixtures` + `tests/guard/scanner.test.ts` | guard report |
| Parser failure never crashes server/hook | always | `tests/hooks/hook-rewrite.test.ts`, `tests/tools/execute-sidecar-integration.test.ts` | vitest |
| `ctx_discover` surfaces top bypasses | yes | `tests/tools/discover.test.ts` | vitest |
| `ctx_read` collapses repeated unchanged reads | yes | `tests/read/ctx-read.test.ts` | vitest |
| `ctx_doctor` reports active tier per adapter | yes | `tests/tools/doctor.test.ts`; `ctx doctor --json` | doctor JSON |
| Router classification latency p95 | <50 ms | `tests/routing/route-explain.test.ts` + benchmark | benchmark report |
| Sidecar quotas honored | yes | `tests/artifacts/run-store.test.ts` | vitest |
| Critical test/build failures never omitted | yes | `npm run eval:fast` (eval `no-critical-omissions`) | `CtxEvalReport` |
| External telemetry absent / local telemetry only | always | `tests/analytics/insight-security.test.ts`, `tests/session/telemetry-summary.test.ts`, `tests/config/context-mode-config.test.ts` | vitest |
| MCP schemas backward-compatible | yes | `build/schema-snapshot.json` diff in `release:reports` | snapshot |
| `CTX_MODE_ROUTER=off` kills rewrite | yes | `tests/hooks/hook-rewrite.test.ts`, env-driven cases | vitest |
| Adapter contract before tier 1 | yes | `tests/adapters/*.test.ts`, `adapter-validation-report.json` | report |
| Named release artifacts produced | candidate report set | `npm run release:reports` | `build/{adapter-validation-report,schema-snapshot,fixture-coverage,semantic-diff-fixture-report,task-cache-readiness-report}.json`, `release-checklist.md` |
| Node engines match CI | yes | `npm pack --dry-run`; `package.json` engines | pack output |
| Bundle drift | none | `npm run assert-bundle`, `assert-asymmetric-drift` | script exit code |
| Config/session DB migration | passes | `tests/session/session-db.test.ts`, `tests/concurrency/sessiondb-multi-process.test.ts` | vitest |

## 4. End-to-End Validation Procedure

Run in order. Each step is gated; stop on first failure and triage.

### Step 1 — Static and unit gates

```bash
npm run typecheck
npm run precommit
npm test
```

Expected: tests pass with skipped markers fully covered by `tests/skip-manifest.json`. Strict skip audit requires every skip/todo marker to have `owner`, `reason`, and non-expired `expiry`.

### Step 2 — Eval harness (correctness invariants)

```bash
npm run eval:fast       # CI-fast bundle
npm run eval:full       # release-only bundle
```

Validates fixture areas: parser summaries, router decisions, redaction, sidecar retention, output budget truncation, native-tool bypass classification, cache hit/miss correctness, semantic diff inventory preservation. Output: `CtxEvalReport` JSON; fail if `failures[].severity === "critical"` or `totals.missing > 0`.

### Step 3 — Guard fixtures (secret + redaction)

```bash
npm run guard:fixtures
```

Validates Feature 16 secret patterns against fixture corpus. Must show zero leakage into chat/FTS/sidecar/analytics paths.

### Step 4 — Benchmark and savings proof

```bash
npm run benchmark:check
npm run benchmark:report
```

Asserts ≥80% returned-byte reduction on supported noisy commands. Audit recorded 87%. Writes `build/benchmark-report.json`.

### Step 5 — Supply chain and release artifacts

```bash
npm run supply-chain:check
npm run release:reports
npm run release:package
npm run release:checksums
node scripts/release-provenance.mjs --allow-dirty   # local diagnostics
```

Produces `build/release-sbom.json`, `release-artifacts/context-mode-<v>.tgz`, `build/SHA256SUMS`, `build/release-provenance.intoto.json`, plus the named candidate artifacts.

### Step 6 — Adapter contract probes

For each adapter under test: stable mutation, experimental opt-in, unsupported, raw-mode kill switch. Driven by `tests/adapters/*.test.ts` and aggregated into `adapter-validation-report.json`. No adapter graduates to tier-1 without capability metadata proving input mutation.

### Step 7 — Hook self-test (per adapter)

```bash
context-mode hook test --adapter <id>
```

Exercises observation, recommendation, opt-in rewrite. Should print effective router mode and adapter tier identical to `ctx doctor --json`.

### Step 8 — Concurrency

```bash
vitest run tests/concurrency/sessiondb-multi-process.test.ts \
           tests/concurrency/routing-run-id.test.ts
```

Multi-process SessionDB writers, WAL pragma retry on constructor, `ensureSession` retry under lock contention, telemetry short busy-timeout fail-open. Validates no stall.

### Step 9 — Kill-switch matrix

Smoke each switch in isolation; assert behavior in `ctx doctor --json`.

| Env | Effect | Verify |
|---|---|---|
| `CTX_MODE_ROUTER=off` | no routing decisions emitted | doctor.routerMode=`off`, no `route.decision` events |
| `CONTEXT_MODE_ROUTER_MODE=recommend` | classify only, no mutation | hook rewrite test green |
| `CONTEXT_MODE_ROUTER_MODE=rewrite` | mutation allowlist active | hook self-test rewrite path |
| `CONTEXT_MODE_RAW=1` | raw escape hatch returns unfiltered | rewrite test |
| `CTX_MODE_EXPERIMENTAL=1` / `CONTEXT_MODE_EXPERIMENTAL=1` | experimental MCP tools become visible | registry/plugin test |
| `CONTEXT_MODE_SIGN_RELEASE=1` | signs SHA256SUMS + provenance | release:checksums |

Spec-only kill switches not implemented as environment variables today: `CTX_MODE_READ`, `CTX_MODE_SIDECAR`, and `CTX_MODE_ANALYTICS`. Do not use those names as release gates until the config layer supports them. Current coverage is tool/config-level behavior, local-only telemetry, redaction before persistence, and experimental tool gating.

### Step 10 — Full release verify

```bash
npm run release:verify
```

Will fail on a dirty worktree (intended). Commit/clean first; then it must pass.

## 5. Behavioral Comparison Matrix: Original Context-Mode vs. RTK Refactor

| Concern | Original | RTK Refactor | How to demonstrate |
|---|---|---|---|
| Routing | implicit, scattered through hooks/server | central `rewrite-registry` + `command-classifier`, single source for hook + server recommendations | `context-mode route --explain "<cmd>"` returns identical decision regardless of caller |
| Explainability | none | route decision JSON: rule id, parser, sidecar plan, confidence, fallback reason | `route --explain` JSON shape stable in `schema-snapshot.json` |
| Hook mutation | none | opt-in, allowlisted, fail-open | `hook test --adapter <id>` |
| Raw output retention | dumped to chat | redacted sidecar, fetch-on-demand | `ctx_fetch_run list/fetch` |
| File reads | native or `ctx_execute_file` only | `ctx_read` with auto/map/outline/slice/symbols/full + repeated-read collapse + provider metadata | `tests/read/ctx-read.test.ts` |
| Analytics | session events, ad-hoc | `ctx_gain` + `ctx_discover` with bypass taxonomy, adapter/agent rollups, session and historical | `ctx_gain --json`, `ctx_discover --session latest` |
| Diff | none | `ctx_diff` text/git mode + inventory invariants | `tests/diff/git-text.test.ts` |
| Trace | none | `TraceSpanRecord` schema, privacy allowlist, local store | `tests/trace/summary.test.ts` |
| Guard | none | `ctx_guard` scanner + secret redaction pipeline | `tests/guard/scanner.test.ts` |
| Eval | none | fixture harness with `CtxEvalReport` | `npm run eval:fast` |
| Cache | none | deterministic task cache explain plus explicit `tsc --noEmit` canary | `tests/cache/explain.test.ts` |
| Output budgets | uniform truncation | adapter manifest (`maxImportantItems`, `maxSearchMatches`, `maxSidecarPreviewBytes`, max returned bytes) | `tests/adapters/output-budget.test.ts` |
| Config | scattered | layered defaults→project→env, project restrictions | `tests/config/context-mode-config.test.ts` |
| Supply chain | manual | SBOM, SPDX validation, signed checksums, in-toto provenance | `npm run supply-chain:check`, `release:checksums`, `release:provenance` |
| Concurrency | implicit | explicit WAL retry, multi-process test, fail-open telemetry | `tests/concurrency/*` |

## 6. Risk-Targeted Regression Tests

Run these specifically when changing any of the listed modules. Each is a thin contract test that catches the most likely regression.

| Module | Risk | Test |
|---|---|---|
| `src/routing/rewrite-registry.ts` | drift between hook and server recommendations | `tests/routing/route-explain.test.ts` asserts identical decision via both code paths |
| `src/routing/command-classifier.ts` | TTY/watch/stdin auto-rewrite mistake | classify-only assertion in same file |
| `src/parsers/registry.ts` | parser crash poisons hook | `tests/parsers/registry.test.ts` + fail-open in `tests/hooks/hook-rewrite.test.ts` |
| `src/artifacts/run-store.ts` | quota purge nukes current run | `tests/artifacts/run-store.test.ts` small-cap retention case |
| `src/filters/pipeline.ts` / `src/artifacts/redaction.ts` | regex regression leaks secrets or bypasses response/index redaction | `tests/filters/pipeline.test.ts`, `tests/guard/scanner.test.ts`, `tests/tools/execute-sidecar-integration.test.ts`, eval `redaction` bundle |
| `src/read/ctx-read.ts` | symbol provider divergence | snapshot via heuristic+TS providers, both asserted |
| `src/tools/gain.ts` | adapter-attribution mis-rollup | `tests/session/telemetry-summary.test.ts` |
| `src/adapters/output-budget.ts` | response over cap | `tests/adapters/output-budget.test.ts` |
| `src/eval/harness.ts` | `.skip` without manifest entry | manifest validator inside harness test |
| `scripts/release-provenance.mjs` | dirty release signed unintentionally | dirty-check rejects without `--allow-dirty` |

## 7. What Is Out of Scope (Future-Scoped)

Tracked in audit. Do **not** mark complete without explicit follow-up tickets:

- Additional `ctx_read` providers (Tree-sitter, LSP-backed, Serena remote symbols).
- Adapter-native capture for unobservable Read/Grep/Glob tools.
- Hosted external provenance attestation (only local SLSA-style produced today).
- Broad deterministic task cache serving beyond the explicit `tsc --noEmit` canary. `ctx_cache run` exists, but remains experimental-gated and canary-limited.
- `ctx_diff` broad semantic mode (TS/AST inventory) — current ship is git-text inventory plus optional Difftastic fallback.
- Wider hook rewrite allowlist (currently `git status`, `rg`, `grep`, `npm test`, `pnpm test`, `pytest`).
- Network-command auto-rewrite remains disabled/classify-only pending stronger URL/header policy. Use `ctx_fetch_and_index` for approved fetches.

## 8. Pass / Fail Sign-off Checklist

Use verbatim in PR description for a release tag.

```
[ ] npm run typecheck
[ ] npm run precommit
[ ] npm test                       (pass, skips = manifest size)
[ ] npm run eval:fast              (no critical failures, missing=0)
[ ] npm run eval:full              (release only)
[ ] npm run guard:fixtures         (no secret leakage)
[ ] npm run benchmark:check        (>=80% reduction)
[ ] npm run benchmark:report       -> build/benchmark-report.json
[ ] npm run supply-chain:check     -> build/release-sbom.json
[ ] npm run release:reports        -> named candidate artifacts
[ ] npm run release:package        -> release-artifacts/*.tgz
[ ] npm run release:checksums      -> build/SHA256SUMS (signed if release flag)
[ ] node scripts/release-provenance.mjs  (clean worktree)
[ ] context-mode hook test --adapter <each tier-1 adapter>
[ ] ctx doctor --json              (routerMode, configSource, tier per adapter)
[ ] kill-switch matrix (Step 9)
[ ] git diff --check
```

If every box is checked and artifacts retained, the slice is releasable. If any box fails, attach the failing artifact and link the triage ticket; do not bypass via `--no-verify` or `--allow-dirty` for a real release.

## 9. Quick Verdict vs. Original Context-Mode

The refactor turns context-mode from "tool collection with hooks" into a **routing/output firewall with a measurement loop**. The original had no central classifier, no explainable routes, no sidecar discipline, no analytics for missed savings, no eval/guard surface, no release supply-chain gates. Every one of those is now testable, gated, and reversible by a single environment variable. The audit reports 87% returned-byte reduction on the benchmark suite — concrete proof the design hits its acceptance threshold.

Where the original implicitly trusted hooks and adapters, the refactor requires capability metadata, contract probes, fail-open semantics, and observability before any adapter graduates to tier-1 mutation. That is the substantive improvement: not new tools, but enforceable invariants around the existing ones.
