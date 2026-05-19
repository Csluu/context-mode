# Review Intake Spec - 2026-05-19

## Scope

This sheet tracks the late Codex/OpenClaw review reports for the Context Mode fork. Findings are merged by code path so repeated reports do not create duplicate work items.

The reviewers all appear to be reading broad session/process telemetry from the same Codex session DB:

`C:\Users\chris\.codex\context-mode\sessions\e4d593fd9d1f984a.db`

The two OpenClaw sessions also appear to share a broad session DB:

`C:\\Users\\chris\\.codex\\context-mode\\sessions\\ed008136d294bbf4.db`

That makes `ctx_stats`, `ctx_gain`, and `ctx_discover` useful directionally, but not task-local evidence for one review. Treat telemetry findings as product feedback unless they identify a concrete code path. Shared session DBs are not inherently a correctness bug; they become actionable when project/session attribution crosses target repos.

## Intake Rules

For each finding:

1. Verify against current source or current command output.
2. Mark as `valid`, `partially valid`, `stale`, or `unverified`.
3. Implement only when it improves security, correctness, CI gating, or release confidence.
4. Add a regression test or explain why the validation is covered elsewhere.
5. Keep unrelated dirty worktree files intact.

## Codex Review 1

| ID | Severity | Finding | Status | Decision |
| --- | --- | --- | --- | --- |
| C1-1 | High | `ctx_index(path)` deny-checks then pre-reads `readFileSync(resolvedPath)` in `src/server.ts`, bypassing `ContentStore.index` fd-bound read path. | valid | Fix now. Let `ContentStore.index({ path })` own path reads/redaction/hash; track indexed bytes from the store result. |
| C1-2 | High | `writeRunArtifact` always calls cleanup, and cleanup enumerates all artifacts even when no TTL/max-byte policy is set. | valid | Fix now. Return immediately when cleanup has no active policy. Keep the >200 exact run-id test, but it should become fast again. |
| C1-3 | Medium | `ctx_guard` sidecar scanning has no `projectDir` parameter and always scans the default project. | valid | Fix now for experimental guard parity. Add `projectDir` to the schema/deps and use the same override resolver as other tools. |
| C1-4 | Medium | Several security-boundary tests are static substring checks, so they miss behavior regressions. | partially valid | Add behavioral tests for the fixes changed in this pass. Keep existing static drift tests where they guard source wiring. |
| C1-5 | Low | `src/server.ts:2286` was cited without a concrete issue. | unverified | No change unless a later review supplies the missing claim. |

## Codex Review 2

| ID | Severity | Finding | Status | Decision |
| --- | --- | --- | --- | --- |
| C2-1 | High | Compare workflow uses `npm ci` while `package-lock.json` is ignored/untracked, so a clean checkout CI run fails. | valid | Fix now by switching compare install steps to `npm install --no-audit --no-fund`. Committing a lockfile is a larger repo policy change because `.gitignore` explicitly ignores it. |
| C2-2 | High | Real-life workflow compare failures do not fail CI. | valid | Fix now. Add workflow side/row verdicts and make `run-workflows` exit nonzero on failed fork/upstream steps. Stop dependent steps after setup/call failure. |
| C2-3 | High | `ctx_read` can read arbitrary non-sensitive absolute files outside the active project by default. | valid | Fix now with a default project containment rule plus narrow external read roots for skills/docs. Add an env allowlist for explicit external reads. |
| C2-4 | Medium | Per-tool compare runner masks intermittent iteration failures if at least one measured iteration succeeds. | valid | Fix now. Require every measured iteration to succeed, and record attempt/success/failure counts. |
| C2-5 | Medium | Compare harness scripts are not covered by normal type/test gates. | valid | Fix now enough for this patch: add Vitest coverage for core compare logic and a `tsconfig.compare.json`/package script. Wire compare typecheck into precommit if it stays fast. |
| C2-6 | Low | Compare workflow lacks explicit permissions and uses moving action tags. | partially valid | Add least-privilege workflow permissions now. SHA-pinning actions is deferred because it requires a dependency update policy decision. |
| C2-7 | Low | Path normalization logic is duplicated across security-sensitive modules. | valid but deferred | Worth doing later as a dedicated refactor with tests; avoid broad path utility churn in this fix pass. |

## Late Codex/OpenClaw Batch

| ID | Severity | Finding | Status | Decision |
| --- | --- | --- | --- | --- |
| L-1 | High | `ctx_index(path)` reintroduces a file-read race by pre-reading content before `ContentStore.index`. | stale / fixed | Already fixed in this pass by passing `{ path }` through to the store and reporting `indexedBytes` from the store result. |
| L-2 | High | Compare MCP client treats `result.isError: true` as a successful call. | valid | Fixed now. `ToolCallResult` carries `isError/errorText`; per-tool and workflow runners fail those calls. |
| L-3 | High | Workflow comparison can exit 0 when workflow steps fail. | stale / fixed | Already fixed in first pass with workflow side verdicts and `run-workflows` nonzero exit. |
| L-4 | Medium | Combined compare runner ignores `assertIssues`. | valid | Fixed now by reusing `exitOnFailure(allRows)` in `run-all.ts`. |
| L-5 | Medium | PR comment step can fail fork PRs or repos without write token permissions. | valid | Fixed now with a same-repo fork guard and `continue-on-error: true`. |
| L-6 | Medium | Run artifact listing can throw if cleanup removes entries during listing. | valid | Fixed now with per-day/per-artifact `try/catch` tolerance in `listRunArtifacts`. |
| L-7 | Medium | Search refresh scans every file-backed source synchronously on every search. | valid but deferred | Real performance risk for large stores, but behavior-sensitive. Track as follow-up for cadence/source-scoped refresh. |
| L-8 | High | Parent fetch guard blocks private IPs by default, but child rebind/redirect guard only blocks private with `CTX_FETCH_STRICT=1`. | valid | Fixed now. Child guard uses `CTX_FETCH_ALLOW_PRIVATE !== "1"` just like the parent guard; `CTX_FETCH_STRICT` is no longer the policy source. |
| L-9 | High | Compare workflow can float upstream main and build unpinned upstream code. | valid | Fixed now by adding a committed upstream pin file and requiring explicit opt-in for local floating re-pin runs. |
| L-10 | High | Clean checkout compare workflow has package-manager/lockfile mismatch risk. | partially valid | `npm ci` was already replaced with `npm install`; npm cache was removed because no lockfile is tracked. The broader `packageManager: pnpm` vs npm script policy is deferred. |
| L-11 | Medium | Explicit `projectDir` can inherit or cache the wrong session attribution. | valid | Fixed now. Overrides no longer inherit base session IDs by default, `currentAttribution` resolves the override project DB, and the session-id cache is keyed by sessions dir + project dir. |
| L-12 | Medium | OpenClaw external repo `projectDir` is operationally blocked unless allowed roots are configured. | valid but deferred | Setup/doctor should print exact `CONTEXT_MODE_ALLOWED_PROJECT_DIRS` remediation. Not a code safety fix because the block is intentional. |
| L-13 | Medium | Synthetic secret fixtures make secret scan noisy/failing. | valid but deferred | Needs fixture allowlist or runtime string construction. Defer to release-gate hygiene pass. |
| L-14 | Medium | Redaction can mangle source/test snippets and make valid code look broken. | valid but deferred | Needs mode-aware redaction preserving quotes/delimiters for code reads. |
| L-15 | Medium | PowerShell pipelines are misclassified as POSIX/interactive-ish. | valid but deferred | Add host-shell dialect awareness and PowerShell route fixtures later. |
| L-16 | Low | Stat validation rejects a possible 100% savings value. | valid | Fixed now by allowing an upper bound of 100. |
| L-17 | Product | Codex/OpenClaw reviews share broad session DBs, so stats/gain are not review-local. | valid product feedback | Defer as task/run scoped telemetry. Label reports more prominently as session/process scoped. |

## Subagent Review Batch

| ID | Severity | Finding | Status | Decision |
| --- | --- | --- | --- | --- |
| S-1 | High | `ctx_index(path)` still had a policy/open race because deny policy checked the path before `ContentStore.index` opened it. | valid | Fixed now. `ContentStore.index` opens first, verifies the current canonical path still names the opened file, validates the opened target path while the fd is held, then reads from that fd. |
| S-2 | Medium | Late fix tests were too source-string heavy for TOCTOU/session/fetch behavior. | partially valid | Added behavioral regression coverage for store path race, compare setup failures, and run-store symlink roots. Session/fetch still have some source-string drift tests; deeper behavioral coverage remains follow-up. |
| S-3 | High | Compare scenario setup failures can still falsely pass because setup exceptions were only notes and setup `client.call` results ignored `isError`. | valid | Fixed now. Scenario setup exceptions mark the side failed before measured calls; setup helpers now use `requireToolOk` for MCP `isError`. |
| S-4 | Medium | Upstream pin can still be a floating ref such as `main`. | valid | Fixed now. Env/local/committed upstream pins must be full 40-character SHAs; floating upstream requires explicit local re-pin mode. |
| S-5 | Medium | Workflow comparison can pass despite successful but divergent step output. | valid but deferred | Needs a workflow contract decision because some workflows include expected volatile output. Track as a compare harness follow-up with per-step canonicalizers or output hashes. |
| S-6 | Medium | Run artifact root can escape via symlinked `.context-mode` or `.context-mode/runs`. | valid | Fixed now. Run-store root resolution rejects symlinked root components and verifies real root containment under the real project before writes/listing. |

## Planned Changes

1. `ctx_index(path)`: remove server-side path content reads and use the store fd-bound read path.
2. Run artifacts: skip cleanup enumeration when no cleanup policy is configured.
3. `ctx_guard`: add `projectDir` to sidecar/file scans and use validated override resolution.
4. `ctx_read`: reject absolute paths outside the effective project root unless they are under `CONTEXT_MODE_ALLOWED_READ_DIRS` or known skill roots (`~/.codex/skills`, `~/.agents/skills`).
5. Compare workflow: use `npm install`, add explicit permissions, and keep reports/artifacts.
6. Compare runner/workflow: fail on any iteration or workflow step failure; surface counts/status in reports.
7. Tests: add/update targeted unit/integration tests for the changed behavior.
8. Compare harness: treat MCP `isError: true` as failure in per-tool and workflow runs.
9. Fetch security: use one private-IP policy in parent and child fetch/rebind/redirect guards.
10. Compare CI: pin upstream comparison target and harden PR comment behavior.
11. Session attribution: key caches by target project/session DB and avoid carrying base session IDs into explicit project overrides.
12. Subagent review fixes: bind `ctx_index(path)` authorization to the opened file, fail compare setup errors, enforce full-SHA upstream pins, and reject symlinked run artifact roots.

## Implementation Log

Completed in this pass:

- `ctx_index(path)` no longer reads file content in `src/server.ts`; it passes `path` to `ContentStore.index`, preserving the fd-bound read/redaction/hash path.
- `IndexResult` now includes `indexedBytes`, so `ctx_index` can still report indexed byte savings without pre-reading path-backed content.
- `cleanupRunArtifacts` returns immediately when no TTL or max-project-byte policy is active, avoiding an all-artifact scan on normal sidecar writes.
- `ctx_read` now rejects absolute paths outside the effective project root by default.
  - External docs/skills remain possible under narrow roots: `~/.codex/skills`, `~/.agents/skills`, or explicit `CONTEXT_MODE_ALLOWED_READ_DIRS`.
  - MSYS-style Windows paths still normalize before policy and actual reads.
- `ctx_guard` now accepts `projectDir` for `scan-file` and `scan-sidecars`, validates it through the same override resolver, and uses it for sidecar lookup and file policy checks.
- Compare workflow now uses `npm install --no-audit --no-fund` instead of `npm ci`, because this repo currently ignores `package-lock.json`.
- Compare workflow now declares least-privilege permissions for contents read and PR issue comments.
- Compare per-tool runner now records attempts/successes/failures and requires every measured iteration to pass.
- Compare workflow runner now records side/workflow status, stops dependent steps after setup/call failure, and exits nonzero when any workflow fails.
- Added `tsconfig.compare.json`, `npm run typecheck:compare`, and wired compare typecheck into `npm run precommit`.
- Added focused Vitest coverage for compare iteration failure and workflow failure gating.
- Compare harness now fails MCP tool results with `isError: true` instead of counting JSON-RPC success as tool success.
- `run-all.ts` now fails on assertion issues by reusing `exitOnFailure`.
- `ctx_fetch_and_index` child-side DNS/redirect/rebind checks now use the same private-network default as the parent guard: private IPs are blocked unless `CTX_FETCH_ALLOW_PRIVATE=1`.
- `listRunArtifacts` now tolerates concurrent cleanup races around day/artifact directories.
- `withOptionalProjectDir`/`currentAttribution` no longer carry a base-project session id into an explicit target project; session-id cache keys include sessions dir and project dir.
- Sidecar attribution for explicit `projectDir` now resolves the target project session DB.
- Compare workflow now disables persisted checkout credentials, guards PR comments to same-repo PRs, makes comment failures non-fatal, removes npm cache that required an untracked lockfile, and uses a committed upstream pin.
- Added `scripts/compare/upstream-pin.json` with the current local `upstream/main` ref (`8963e8116b6313d665ccc10d0351bc00a47f05b2`).
- `tests/compare/stat-validate.ts` now permits a reported 100% savings value.
- Subagent review completed with three independent lanes: security/project scoping, compare/CI, and run-store/telemetry/spec accuracy.
- `ContentStore.index({ path })` now binds authorization to the opened file: open fd, validate regular file, confirm canonical path still names that fd, run policy validation, then read fd.
- Compare scenario setup failures now fail the scenario before measured calls, and compare setup hooks use `requireToolOk` to reject MCP `isError` seed calls.
- Compare upstream pins are now validated as full commit SHAs for env/local/committed pin sources.
- Run artifact root resolution now rejects symlinked `.context-mode` / `runs` components and verifies realpath containment under the project root.
- Added regression tests for the store path swap race, run-store symlinked root rejection, and compare setup failure handling.

Deferred:

- SHA-pinning GitHub actions is left for a dependency/update policy pass.
- Centralizing duplicated path-normalization logic remains a follow-up refactor.
- Task-local Context Mode telemetry remains a product/tooling improvement.
- Store stale-source refresh cadence/source scoping remains a follow-up performance change.
- Secret-scan fixture cleanup remains a release-gate hygiene follow-up.
- PowerShell route classification and Graphify staleness warnings remain tooling follow-ups.
- Workflow step output parity remains a compare-harness follow-up pending canonicalizer/volatility rules.

## Deferred Product Feedback

- Task-local `ctx_stats` / `ctx_gain` / `ctx_discover` scoping.
- Long-running `ctx_execute` behavior before host RPC timeout.
- `npm audit` route/parser.
- Redaction display markers that avoid making valid source slices look syntactically broken.
- Graphify stale-commit warnings.
- Native-tool bypass telemetry via Codex/OpenClaw hook events.

## Verification Plan

- Focused Vitest for changed modules:
  - `tests/core/server.test.ts`
  - `tests/tools/read.test.ts`
  - `tests/guard/scanner.test.ts`
  - `tests/artifacts/run-store.test.ts`
  - new compare harness tests
- `npx.cmd tsc --noEmit`
- `npm.cmd run typecheck:compare`
- `npm.cmd run precommit`
- `npm.cmd test` if focused checks pass
- `git diff --check`

## Verification Results

- `npx.cmd tsc --noEmit` - passed after the final late-batch fixes.
- `npm.cmd run typecheck:compare` - passed after the final late-batch fixes.
- `npm.cmd run build` - passed after the final late-batch fixes.
- Focused Vitest set for compare, SSRF/session attribution, and run-store - passed: 4 files, 194 passed, 10 skipped.
- `npm.cmd run precommit` - passed after the final late-batch fixes.
- `npm.cmd audit --omit=dev` - passed after the final late-batch fixes.
- `npm.cmd test` - passed after the final late-batch fixes: 102 files passed, 20 skipped; 1721 tests passed, 679 skipped.
- `npm.cmd run assert-bundle` - covered by build/test and passed.
- `git diff --check` - passed after the final late-batch fixes.
- MCP `ctx_doctor` still reports the stale in-process PreToolUse failure, but standalone `context-mode doctor` passes against `C:\Users\chris\.codex\hooks.json`; restart the MCP server/session before trusting that one MCP diagnostic.
- `ctx_gain` current session: 3.42MB returned, 307.28MB kept out, 99% savings, 271 sidecars. This is session-scoped, not review-scoped.
- `ctx_discover`: no observable bypasses; native-tool bypasses remain not measurable without adapter event capture.
- Final rerun note: standalone `node build/cli.js doctor` passes against `C:\Users\chris\.codex\hooks.json`; MCP `ctx_doctor` still shows the stale in-process PreToolUse failure until the MCP server/session is restarted.
- Final rerun note: latest `ctx_gain` is 3.67MB returned, 318.73MB kept out, 99% savings, 286 sidecars. This remains session-scoped, not review-scoped.
- Final rerun note: after the same-project session inheritance refinement, `npx.cmd tsc --noEmit`, `tests/core/server.test.ts`, and the full `npm.cmd test` suite still pass; final full suite count is 102 files passed, 20 skipped, 1721 tests passed, 679 skipped.
- Subagent review verification: `npx.cmd tsc --noEmit`, `npm.cmd run typecheck:compare`, focused Vitest for store/run-store/compare/server/deny-policy, `npm.cmd run precommit`, `npm.cmd test`, and `git diff --check` passed after subagent-driven fixes. Final full suite count is 102 files passed, 20 skipped; 1725 tests passed, 679 skipped.
