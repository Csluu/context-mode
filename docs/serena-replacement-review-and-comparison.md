# Serena Replacement Spec Review And Comparison

Status: replacement gate passed for default static navigation
Date: 2026-05-21

## Scope

This document records the review process for `docs/serena-replacement-static-code-intelligence-spec.md` and the current comparison evidence for replacing Serena as the default code-navigation dependency.

Latest result: Context Mode is now the default static code-navigation path for TS/JS/Rust. The combined gate `tests/compare/serena-removal.ts --real-repos --require-direct-serena-rows --check` passed on 2026-05-21 with live direct Serena rows, `widget-launcher`, `mission-control`, and the Rust navigation fixture. Serena remains an optional precision fallback for exact semantic refactors, type-aware rename, and LSP-level references.

## Self-Review

Result: patched before subagent review.

Findings accepted:

- The spec still had open questions that would leave implementation choices unresolved.
- The removal gate needed to treat missing direct Serena rows as a blocker, not as an ignorable optional baseline.
- The comparison report needed to distinguish strong Context Mode workflow compression from a true Serena replacement decision.

Changes made:

- Replaced the Open Questions section with resolved decisions and phase gates.
- Added the rule that direct Serena row failure blocks the removal decision; MCP transport failure is recorded as a reliability finding unless a live MCP check is explicitly required.
- Generated a comparison artifact in `build/compare/serena-replacement-comparison-2026-05-20T23-51-45-329Z.md`.

## Subagent Team Review

Five review lanes were dispatched:

- Architecture and scope
- Current repo implementation fit
- Security, cache, and multi-terminal behavior
- Benchmark and Serena comparison validity
- Dependency, package, and Windows install risk

Accepted findings and patches:

- Default routing must not switch to Context Mode static tools before the removal gate passes.
- Feature-entry discovery belongs to the Context Pack Advisory Gate unless constrained to explicit static facts.
- Non-goals must explicitly exclude call graphs, transitive dependency graphs, framework architecture inference, cross-language resolution, and subsystem explanation.
- Phase 2 needs an MVP boundary: lazy per-file/per-symbol indexing only, no eager whole-repo crawl, no unbounded fanout, and no durable architecture traversal.
- Denied path storage conflicted with the schema; denied paths now use `code_denials` only.
- Multi-terminal stale overwrite protection needed commit-time re-stat/hash and compare-and-swap semantics.
- Windows canonicalization tests now include UNC long forms, 8.3 short names, drive-relative paths, and trailing dot/space normalization.
- Live Serena needs a concrete runner contract with tool discovery, activation, per-scenario invocation, comparable normalization, and row-level validity.
- Oracle fixtures need provenance, independent validation, and per-scenario quality thresholds.
- Real repo reproducibility needs at least one public pinned fixture repo or archived snapshot.
- Removal benchmarks must record provider name/confidence and include a packaged/global install oracle subset with dev dependencies omitted.
- TypeScript runtime promotion is subject to the same lockfile/package-manager gate as parser dependency work.
- Windows global install checks must verify packed-artifact install in a path with spaces, `.cmd` shim execution, postinstall, and optional/native fallback.
- Phase 2 must add a shared read authorization/open/redaction helper before index writes so indexing cannot read/hash before the effective `ctx_read` deny policy runs.
- Phase 3 must explicitly update OpenClaw's manual bridge definitions and schema tests for `ctx_code`.
- Phase 4 must add the `compare:serena-removal` npm script.

Resolved blocker:

- Live Serena MCP remains broken, but a direct in-process Serena baseline was collected after a contained Python platform monkeypatch that bypasses Windows WMI hangs in `platform.system()`, `platform.platform()`, and `platform.machine()`.
- This is sufficient evidence for sizing Serena's useful symbolic outputs, but not sufficient to keep Serena as a reliable default dependency.

## Current Comparison Evidence

Commands run:

- `npm.cmd run compare:tokens`
- `npm.cmd run compare:research`
- `npm.cmd run compare:real-repos`
- Direct Serena MCP probes:
  - `initial_instructions` failed: `Transport closed`
  - `activate_project` failed: `Transport closed`
- Serena CLI probes:
  - `where.exe serena` succeeded, so a Serena executable is on PATH.
  - `serena --version` did not return before the tool timeout.
  - Many `serena` processes were already running, consistent with the user's report that Serena is unstable with many AI terminals.
- Clean-retry probes:
  - Existing `serena` processes were terminated with user approval.
  - MCP `initial_instructions` still failed with `Transport closed`.
  - `serena --version` still timed out.
  - `serena project health-check "C:\Users\chris\Documents\GitHub\context-mode"` started, loaded config and gitignore data, then timed out before completing.
  - After the timed-out health-check, no `serena` processes remained running.
- Alternate project-server probes:
  - Serena's installed `project_server.py` exposes `/heartbeat` and `/query_project` for read-only project tools.
  - A contained `serena start-project-server` attempt on localhost did not reach `/heartbeat`; logs stopped after loading Serena config.
  - `serena project index-file -v src/read/ctx-read.ts "C:\Users\chris\Documents\GitHub\context-mode"` also timed out and left a `serena` process, which was terminated with approval.
  - This confirms the blocker is not only Codex MCP transport; Serena's project/LSP initialization path is unhealthy for this repo/session.
- Root-cause probes:
  - Serena is installed as `serena-agent` 1.5.1 under the uv tool environment.
  - `serena --version` hangs while calling `serena.util.git.get_git_status()`, which reaches Python's Windows platform/WMI code.
  - `SerenaAgent` construction also hung in `platform.platform()`.
  - `Project.create_language_server_manager()` then hung in SolidLSP TypeScript server import through `platform.machine()`.
  - Monkeypatching `platform.system`, `platform.platform`, `platform.machine`, `platform.processor`, `platform.architecture`, `platform.win32_ver`, and `platform.uname` let Serena create the TypeScript language server manager and enter active project context.
- Direct patched Serena baseline:
  - Cold load to usable project context: 1,198-1,266 ms.
  - `read_file package.json` first 20 lines: 600 B, 61 ms.
  - `get_symbols_overview src/read/ctx-read.ts`: 779 B, 47 ms.
  - `find_symbol ctxRead` location only: 142 B, 14 ms.
  - `find_symbol ctxRead` with body: 4,947 B, 102 ms.
  - `find_referencing_symbols ctxRead`: 2 B, 2,130 ms, returned `{}`.
- Current Context Mode comparable rows:
  - `ctx_read symbols compact src/read/ctx-read.ts`: 1,586 B, 355 ms on first TypeScript parse.
  - `ctx_read map compact src/read/ctx-read.ts`: 1,921 B, 12 ms after cache warmup.
  - `ctx_read slice compact` for the `ctxRead` body: 5,282 B, 9 ms.

Generated comparison artifact:

- `build/compare/serena-replacement-comparison-2026-05-20T23-51-45-329Z.json`
- `build/compare/serena-replacement-comparison-2026-05-20T23-51-45-329Z.md`
- `build/compare/serena-replacement-comparison-2026-05-21T00-31-36-319Z.json`
- `build/compare/serena-replacement-comparison-2026-05-21T00-31-36-319Z.md`
- `build/compare/serena-replacement-comparison-2026-05-21T01-09-04-189Z.json`
- `build/compare/serena-replacement-comparison-2026-05-21T01-09-04-189Z.md`

Latest generated evidence:

- Token suite: `tokens-2026-05-20T23-49-39-302Z.json`
- Research suite: `research-report-2026-05-20T23-49-49-838Z.json`
- Real repo smoke: `real-repos-2026-05-20T23-50-02-039Z.json`

Results:

- Token suite: raw 149,549 B, fork 20,088 B, 86.6% saved.
- Token suite upstream+fallback: 103,982 B, 30.5% saved.
- Token suite Serena rows: 0 usable rows in the latest generated report because no `serena-baseline-*` file was present.
- Workflow research suite: 125/125 quality rows passed.
- Workflow research suite: raw 19,161,658 B, fork 224,692 B, 98.8% saved.
- Workflow research suite upstream+fallback: 19,137,598 B, 0.1% saved.
- Real repo smoke: `mission-control` missing at the default path; `widget-launcher` present with 93.5% map savings and 71 B compact-slice overhead.
- Direct live comparison:
  - Serena is still more compact for exact symbol navigation than current `ctx_read` output.
  - Context Mode is already close on symbol body reads and much faster once it can use an exact line range.
  - Serena's reference lookup was slow and empty in this sample, so it is not a reliable refs baseline for this repo/session.
  - The replacement spec must therefore beat Serena on exact symbol lookup/output shape, not only broad workflow compression.

Decision:

```text
proceed-with-spec, keep-removal-gated
```

Reason:

Context Mode is still strongly ahead of raw/upstream for broad workflow compression, and the direct patched Serena baseline confirms the right replacement target: compact static symbol lookup, exact symbol body reads, and code-aware packs. Serena should not remain the default dependency in this environment because MCP transport closes, unpatched CLI and health/index commands hang, project-server queries are brittle, and the working baseline required monkeypatching Python platform calls. Full removal is still gated on implementing the spec and producing a passing `compare:serena-removal` report with nonzero live rows or an explicit archived Serena baseline.

## Next Required Work

Before claiming Serena replacement is complete:

1. Implement `compare:serena-removal` with the runner/oracle/package gates from the spec.
2. Reuse the direct patched Serena runner as the live baseline path, and keep MCP transport failure as a reliability finding.
3. Add at least one public pinned fixture repo or archived snapshot.
4. Run the packaged/global install oracle subset with dev dependencies omitted.
5. Produce a passing `compare:serena-removal` report with nonzero live Serena rows.
