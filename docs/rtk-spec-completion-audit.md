# RTK Spec Completion Audit

Date: 2026-05-17

Objective audited: implement the RTK-inspired context-mode spec sheet as the first implementation slice for a routing/output firewall.

## Success Criteria

- Context-mode has a shared command router, rewrite registry, explainable route decisions, and opt-in hook mutation.
- Noisy command output can be parsed, compacted, sidecarred, fetched later, and measured for savings.
- File reads have safe `ctx_read` modes, provider metadata, repeated-read collapse, and path/binary protections.
- Analytics can explain savings, missed savings, bypass classes, parser confidence, and tool latency.
- Runtime hardening covers command semantics, TTY/stdin/watch classification, adapter permission boundaries, output budgets, and fail-open behavior.
- Supply-chain and release gates produce the named artifacts from the spec.
- Tests and generated bundles prove the behavior, not just the design intent.

## Prompt-To-Artifact Checklist

| Requirement | Evidence |
| --- | --- |
| Rewrite registry and route explainability | `src/routing/rewrite-registry.ts`, `src/routing/command-classifier.ts`, `src/routing/command-coverage.ts`, `src/tools/route.ts`; tests `tests/routing/route-explain.test.ts`, `tests/routing/command-coverage-manifest.test.ts` |
| Command semantics preservation | `src/cli.ts` `context-mode run`, argv-boundary handling, exit-code preservation, cwd/env inheritance, stdin passthrough, PATH lookup, and stdout/stderr separation; tests `tests/cli/run-command.test.ts`, `tests/executor.test.ts`. Signal/interactive TTY behavior remains classify-only rather than auto-rewrite coverage. |
| Interactive/TTY/watch/stdin classify-only policy | `src/routing/command-classifier.ts`, `src/routing/rewrite-registry.ts`; tests `tests/routing/route-explain.test.ts` |
| Hook permission semantics and adapter mutation tiers | `hooks/core/routing.mjs`; tests `tests/hooks/hook-rewrite.test.ts` |
| CLI wrapper surface | `src/cli.ts`; tests `tests/cli/run-command.test.ts`, `tests/cli/hook-self-test.test.ts` |
| Parser/filter taxonomy | `src/parsers/registry.ts`, `src/filters/pipeline.ts`; tests `tests/parsers/registry.test.ts`, `tests/filters/pipeline.test.ts` |
| Raw sidecar store, fetch, pinning | `src/artifacts/run-store.ts`, `src/tools/fetch-run.ts`; tests `tests/artifacts/run-store.test.ts`, `tests/tools/route-fetch-run.test.ts`. Sidecars preserve the just-written run under small project caps and fail open on stale metadata. |
| Executor-adjacent stream capture | `src/executor.ts` `outputCapture`; test `tests/executor.test.ts` |
| Sidecar quotas, TTL, project caps | `src/artifacts/run-store.ts` `maxRunBytes`, `cleanupRunArtifacts`; test `tests/artifacts/run-store.test.ts` |
| `ctx_read` modes and safety | `src/read/ctx-read.ts`, `src/tools/read.ts`; tests `tests/read/ctx-read.test.ts`, `tests/tools/read.test.ts` |
| `ctx_read` repeated unchanged read collapse | `src/read/ctx-read.ts`; test `tests/read/ctx-read.test.ts` |
| Higher-fidelity code map provider with fallback | TypeScript compiler provider in `src/read/ctx-read.ts`; test `tests/read/ctx-read.test.ts` |
| JSON-first/parser confidence behavior | `src/parsers/registry.ts`, parser telemetry in `src/session/event-emit.ts`; tests `tests/parsers/registry.test.ts`, `tests/tools/execute-sidecar-integration.test.ts` |
| `ctx_gain` analytics | `src/tools/gain.ts`, `src/session/telemetry-summary.ts`; tests `tests/tools/gain.test.ts`, `tests/session/telemetry-summary.test.ts` |
| `ctx_discover` missed-savings scanner and bypass taxonomy | `src/tools/discover.ts`; tests `tests/tools/discover.test.ts` |
| Fail-open parser/hook behavior | `hooks/core/routing.mjs`, `src/parsers/registry.ts`, `src/server.ts`; tests `tests/hooks/hook-rewrite.test.ts`, `tests/tools/execute-sidecar-integration.test.ts` |
| Verbosity/raw escape hatches and kill switches | `CONTEXT_MODE_RAW`, `CONTEXT_MODE_ROUTER_MODE`, `CTX_MODE_ROUTER`; tests `tests/hooks/hook-rewrite.test.ts`, `tests/config/context-mode-config.test.ts` |
| Adapter output budgets | `src/adapters/output-budget.ts`; tests `tests/adapters/output-budget.test.ts`, `tests/tools/route-fetch-run.test.ts` |
| Config precedence and project restrictions | `src/config/context-mode-config.ts`; tests `tests/config/context-mode-config.test.ts` |
| `ctx_doctor --json`, router source, integration tier | `src/tools/doctor.ts`; tests `tests/tools/doctor.test.ts` |
| SessionDB concurrency and WAL/SHM migration | `src/session/db.ts`, `src/db-base.ts`; tests `tests/session/session-db.test.ts`, `tests/concurrency/sessiondb-multi-process.test.ts`. Telemetry readers/writers use short busy timeouts and fail open rather than waiting on durable DB retry policy. |
| Supply-chain checks and SBOM | `scripts/supply-chain-check.mjs`; artifact `build/release-sbom.json`; tests `tests/release/supply-chain-check.test.ts`. Gate now validates approved SPDX-style license expressions instead of accepting any non-empty license string. |
| Release package, checksums, provenance | `scripts/release-package.mjs`, `scripts/release-checksums.mjs`, `scripts/release-provenance.mjs`; artifacts `release-artifacts/context-mode-1.0.135.tgz`, `build/SHA256SUMS`, `build/release-provenance.intoto.json`; tests `tests/release/*`. Npm tarball excludes release metadata, and provenance can be signed under the release signing flag. |
| Named release candidate artifacts | `scripts/release-candidate-reports.mjs`, `tests/live-benchmark.ts --json-out`; artifacts `build/benchmark-report.json`, `build/adapter-validation-report.json`, `build/schema-snapshot.json`, `build/fixture-coverage.json`, `build/release-checklist.md`; test `tests/release/release-candidate-reports.test.ts`. Fixture coverage now maps claimed areas to concrete test evidence and fails when evidence is missing. |
| OpenClaw tool registry | `src/adapters/openclaw/mcp-tools.ts`; tests `tests/plugins/openclaw.test.ts` |
| Graphify setup/fresh graph | `graphify-out/GRAPH_REPORT.md`; final refresh reports 9225 nodes, 42317 edges, 337 communities |

## Verification Evidence

- `npm test`: latest full validation passed with 93 files passed, 21 skipped, 1593 tests passed, and 684 skipped. Pretest build passed and all bundles were fresh.
- `npm run precommit`: passed.
- `npm run benchmark:check`: passed, 87 percent overall returned-byte savings.
- `npm run supply-chain:check`: passed, 244 dependencies scanned.
- `npm run benchmark:report`: passed, wrote `build/benchmark-report.json`.
- `npm run release:reports`: passed, wrote adapter/schema/fixture/checklist artifacts.
- `npm run release:package`: passed, wrote `release-artifacts/context-mode-1.0.135.tgz`.
- `npm run release:checksums`: passed, 14 artifacts in `build/SHA256SUMS`; unsigned note present because signing env was not enabled.
- `node scripts/release-provenance.mjs --allow-dirty`: passed, 15 provenance subjects; dirty warning expected for local diagnostics.
- `git diff --check`: passed.

## Explicitly Future-Scoped

- Hosted external provenance attestation remains outside local implementation; local in-toto/SLSA-style provenance, SBOM, package, and checksums are implemented.
- Additional code-map providers beyond TypeScript compiler plus heuristic fallback, such as Tree-sitter, language server references, and Serena-compatible remote symbols, remain extension points.
- Fully unobservable native Read/Grep/Glob calls cannot be captured without adapter support; observable/native bypass categories are recorded and reported where events exist.

Audit result: first implementation slice complete against the spec's implementable local requirements. Strict `npm run release:verify` is expected to fail until the worktree is clean because release provenance intentionally rejects dirty release builds.
