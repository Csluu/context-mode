# Fork vs Upstream — Test Plan

Compares this fork (`tier2/refactor`) against upstream `mksglu/context-mode@main` (currently v1.0.142). Goal: prove fork preserves shared behavior, quantify deltas, and validate fork-only features actually deliver.

## Scope

In scope:

| Dim | What it answers |
|-----|-----------------|
| 1. Context savings % | Does fork keep upstream's bytes-saved ratio across shared tools? Is fork-only behavior at least as efficient? |
| 2. Latency / throughput | Per-tool wall-clock under matched inputs (cold + warm). |
| 3. Behavioral parity | Same input → same output shape for shared tools (`ctx_read`, `ctx_route`, `ctx_execute`, `ctx_search`, `ctx_fetch_and_index`, `ctx_batch_execute`, `ctx_stats`, `ctx_gain`, `ctx_discover`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_fetch_run`). |
| 4. Fork-specific value | Do parsers/registry, guard, eval, trace, diff, cache tools deliver measurable benefit? |
| 5. Real-life workflows | Multi-tool sequences mirroring real Claude Code sessions — totals + per-step deltas, not just per-tool. |
| 6. Stat validation | Are `ctx_stats` / `ctx_gain` / `ctx_discover` numbers consistent with externally measured bytes? |

Out of scope: subjective DX, marketing copy, install UX, adapter installers, hook plumbing (covered by inherited test suite).

## Setup — sibling checkout

Layout:

```
GitHub/
├─ context-mode/                 # this fork (tier2/refactor)
└─ context-mode/.compare/
   └─ upstream/                  # pinned mksglu/context-mode@<SHA>
```

Pin upstream by SHA (not branch). Pinned SHA + tip-tag stored in `.compare/UPSTREAM_SHA`. `scripts/compare/clone-upstream.mjs` clones, checks out the pinned SHA, runs `npm ci && npm run build`.

Why sibling not Docker: identical Node/Bun runtime, identical OS, fastest iteration, deterministic. Docker matrix can layer on later for cross-platform validation.

Each comparison run records: fork SHA, upstream SHA, Node version, Bun version, OS, CPU, total RAM.

## Harness architecture

```
tests/compare/
├─ runner.ts            # stdio MCP JSON-RPC client (no SDK dep)
├─ lib.ts               # canonicalize, parity grade, runScenario, report
├─ suite.ts             # Suite shape (name, scenarios, beforeAll, afterAll, env, forkOnly)
├─ fixture-server.ts    # local HTTP server for ctx_fetch tests
├─ run.ts               # generic single-suite runner: tsx run.ts <name>
├─ run-all.ts           # orchestrator: runs every suite + combined report
├─ stat-validate.ts     # ctx_stats / ctx_gain cross-checked against external bytes
├─ run-workflows.ts     # workflow orchestrator
├─ tools/
│  ├─ ctx-read.ts       # map | outline | symbols | slice
│  ├─ ctx-route.ts      # classify (git diff, npm test, curl, etc.)
│  ├─ ctx-execute.ts    # js | shell | intent-driven
│  ├─ ctx-batch.ts      # commands + queries
│  ├─ ctx-search.ts     # seeded index + matched queries
│  ├─ ctx-fetch.ts      # local fixture URLs, single + batch
│  ├─ ctx-stats.ts      # ctx_stats/ctx_gain/ctx_discover parity (shape only)
│  ├─ value-parsers.ts  # fork-only: parser-driven bytes reduction
│  ├─ value-diff.ts     # fork-only: ctx_diff compressed-diff bytes
│  └─ value-trace.ts    # fork-only: ctx_trace summary bytes
└─ workflows/
   ├─ index.ts          # Workflow shape + runner + reporter
   ├─ bug-hunt.ts       # route → batch_execute → search → read → execute
   ├─ doc-lookup.ts     # fetch x2 → search x2
   ├─ codebase-explore.ts # read map/outline/symbols → search → slice
   ├─ log-triage.ts     # execute logs → execute counts → search
   └─ debug-test.ts     # execute vitest sim → search → read outline
```

Reports land in `build/compare/<suite>-<timestamp>.{json,md}` plus `all-<timestamp>.{json,md}` from the orchestrator.

Each scenario yields:

```ts
{
  tool: "ctx_read",
  scenario: "outline-large-ts",
  fork:    { ms: 14.2, bytes_out: 482, bytes_saved_pct: 96.1, ok: true },
  upstream:{ ms: 12.8, bytes_out: 478, bytes_saved_pct: 96.3, ok: true },
  delta:   { ms_pct: +10.9, bytes_pct: +0.8, parity: "match" },
}
```

Parity grades: `match` (byte-equal after canonicalization), `equivalent` (semantic equal — same keys, tolerable numeric drift), `divergent` (different shape, document why).

## Dim 1 — Context savings %

Reuse the `tests/benchmark.ts` + `tests/live-benchmark.ts` methodology. For each tool invocation, capture:

- `raw_bytes` — uninstrumented baseline (direct `fs.readFileSync`, raw `curl`, etc.)
- `fork_bytes` — fork's MCP response payload
- `upstream_bytes` — upstream's MCP response payload
- `saved_fork_pct = 1 - fork_bytes/raw_bytes`
- `saved_upstream_pct = 1 - upstream_bytes/raw_bytes`

Workloads:

| Scenario | Raw input | Tool exercised |
|----------|-----------|----------------|
| Large TS file outline | 50 KB+ TS source | `ctx_read mode:outline` |
| Symbol map | 50 KB+ TS source | `ctx_read mode:symbols` |
| Slice | 50 KB+ TS source | `ctx_read mode:slice` |
| Test runner output | 500-line vitest log | `ctx_execute` w/ `intent:"failing tests"` |
| Git log | 2000-commit `git log` | `ctx_batch_execute` + `ctx_search` |
| HTTP doc fetch | React useEffect docs (canned) | `ctx_fetch_and_index` |
| TSC error parse | 200-line tsc output | `ctx_execute` parser:`generic-failure` |

Baseline lives at `tests/fixtures/live-benchmark-baseline.json` (already present). Fork must stay within ±5% of upstream savings %, or document why (e.g., fork-added redaction enriches output → bigger byte count but more signal).

## Dim 2 — Latency / throughput

Per tool, 3 cold runs + 30 warm runs. Report median + p95.

Tools timed:

- `ctx_read` × 4 modes (`map`, `outline`, `symbols`, `slice`)
- `ctx_route classify`
- `ctx_execute` (small JS, big JS, shell)
- `ctx_search` (1 query, 5 queries)
- `ctx_fetch_and_index` (1 URL, 5 URLs concurrency=5)
- `ctx_batch_execute` (3 commands, 5 queries)
- `ctx_stats` / `ctx_gain` / `ctx_discover` / `ctx_doctor`

Gate: fork must not regress median >15% on any tool. p95 may swing wider (record only).

Network-dependent tools use a local fixture HTTP server (`tests/compare/fixtures/server.ts`) to keep numbers stable.

## Dim 3 — Behavioral parity

For each shared tool, canonicalize and diff:

- Strip env-dependent fields: timestamps, run IDs, project dir paths, version strings, line counts that depend on local build.
- Sort arrays where order is non-semantic.
- Compare JSON-RPC `result.content[*].text` after canonicalization.

Match criteria:

- `ctx_read` outline/symbols/slice/map — exact match expected (fork modified `src/tools/read.ts` and `src/read/ctx-read.ts`, so this is the hottest target).
- `ctx_search` — top-N IDs must match; BM25 score deltas <10%.
- `ctx_route classify` — same classification + same explanation keys.
- `ctx_execute` — same stdout, same exit code; latency excluded from parity check.
- `ctx_fetch_and_index` — same indexed section count for same URL.
- `ctx_stats` — same keys present; numeric values not compared (session-scoped).

Divergences expected (documented as intentional):

- `ctx_doctor` — fork adds checks → fork output is a superset.
- `ctx_route` — fork adds command classifications (`src/routing/command-classifier.ts`, `rewrite-registry.ts`).
- `ctx_stats` — fork adds RTK persistent-memory categories.

## Dim 5 — Real-life workflows

Per-tool parity isn't how the model actually uses the system. Real sessions chain tools: route → batch → search → read → execute. The workflow harness mirrors that:

- Each `Workflow` is an ordered list of `WorkflowStep`s.
- Steps can read prior outputs via a `WorkflowContext` so a `search` query can reference a string surfaced by an earlier `batch_execute`.
- Steps run sequentially on the fork client, then re-run sequentially on the upstream client (same isolated `CONTEXT_MODE_HOME`).
- Metrics: per-step `ms` + `bytes`, total `ms` + `bytes`, optional `rawBaseline` for end-to-end savings %.

Shipped workflows:

| Workflow | Steps | What it emulates |
|----------|-------|------------------|
| `bug-hunt` | `ctx_route` → `ctx_batch_execute` (git status/log/diff) → `ctx_search` → `ctx_read` (outline) → `ctx_execute` | Triage failing change against `main` |
| `doc-lookup` | `ctx_fetch_and_index` × 2 → `ctx_search` × 2 | Research React + Next API from canned docs |
| `codebase-explore` | `ctx_read` (map, outline, symbols) → `ctx_search` → `ctx_read` (slice) | Drop into unfamiliar code |
| `log-triage` | `ctx_execute` (generate logs) → `ctx_execute` (count) → `ctx_search` | Triage noisy stdout via sandbox |
| `debug-test` | `ctx_execute` (vitest sim) → `ctx_search` → `ctx_read` | React to failing test output |

Report shape: summary table (total ms / bytes / savings %) + per-workflow step table. `npm run compare:workflows` writes `build/compare/workflows-<ts>.{json,md}`.

Workflows are the right level for measuring *cumulative* fork overhead. If every per-tool parity passes but workflows regress, fork-side composition (caching, indexing side-effects, async ordering) is the culprit.

## Dim 4 — Fork-specific value

Fork-only features need outcome-based tests, not just unit tests:

| Feature | What to measure | How |
|---------|-----------------|-----|
| RTK persistent-memory categories | Resume quality after `/compact`: fraction of "what were we doing?" answerable from snapshot alone | Scripted compaction replay; score categories present |
| OpenClaw + Codex runtime fix | E2E: spawn Codex CLI w/ fork plugin, run prompts, verify hook events fire | Already in `scripts/test-openclaw-e2e.sh` — extend to comparison |
| `src/parsers/registry.ts` (generic-failure, failure-focus, vitest, pytest, rg, git-status, git-diff) | Bytes-saved on parsed output vs raw | Add scenarios to Dim 1 — upstream lacks these parsers, so this measures fork-only delta |
| `src/guard/scanner.ts` | Detection rate on known-bad fixtures | Run guard against `tests/fixtures/` malicious-pattern set |
| `src/eval/harness.ts` | Eval pass-rate on canned conversations | Run `npm run eval:full` against fork only (upstream lacks harness) |
| `src/trace/summary.ts` | Trace summary information density | Compare trace bytes vs raw event log |
| `src/diff/git-text.ts` | Diff readability bytes saved | Same diff input, compare fork output bytes vs raw `git diff` |
| `src/cache/explain.ts`, `cache/run.ts` | Cache hit rate over realistic session | Replay session, measure hit rate |
| `output-budget.ts` | Adapter output size compliance | Inject oversize payloads, verify clamping per adapter |
| `fetch-rate-limit.ts` per-host concurrency | Throughput under multi-host fetch | Same Dim 1 fetch scenario, measure host fairness |

## Dim 6 — Stat validation

`ctx_stats`, `ctx_gain`, and `ctx_discover` self-report context savings. Two layers of check:

1. **Shape parity** (suite `ctx-stats`) — both servers return the same response shape after canonicalization that replaces numeric values with `<N>`. Catches output-format regressions, not numeric drift.
2. **External cross-check** (`tests/compare/stat-validate.ts`) — runs a deterministic workload (3-command batch + 2 searches + 1 execute), records true per-call `bytes_out` and `args_bytes` via the stdio client, then calls `ctx_stats` / `ctx_gain` / `ctx_discover`. Regex-extracts every `X%` candidate and every `ctx_<tool>: N` count. Verdict:

| Check | Pass if |
|-------|---------|
| Calls recorded | Workload produced >0 calls |
| Bytes returned | `bytes_out > 0` on at least one call |
| Savings parsed | At least one `X%` field extracted from `ctx_stats` or `ctx_gain` |
| Direction | Reported savings ∈ [0, 99] (no negative or impossible values) |

`npm run compare:stats-validate` writes `build/compare/stat-validate-<ts>.{json,md}`. The JSON keeps the raw `ctx_stats` body so regressions in format are easy to diff manually. Exit code: 1 if **fork** fails; upstream failure is informational.

Why tolerant: stat output is human text, not a JSON contract. A stricter validator would over-fit to a specific render and break on every cosmetic change. Tighten the regexes once both repos pin a stats output format.

## Baselines + gating

Stored at `tests/fixtures/compare-baseline.json`. CI workflow `.github/workflows/compare-upstream.yml` (new) runs on every PR to `main` and on a nightly schedule against latest upstream tip.

Thresholds:

- Savings %: ±5 percentage points of upstream
- Latency median: ≤+15% vs upstream
- Parity grade per shared tool: `match` or `equivalent`; `divergent` requires entry in `docs/fork-divergences.md`

Failures post a comment with the comparison delta table.

## Output format

Two artifacts per run:

- `build/compare/<timestamp>.json` — machine-readable
- `build/compare/<timestamp>.md` — human report with delta tables

Report top section:

```
Fork:      tier2/refactor @ <sha-short>
Upstream:  mksglu/context-mode@<sha-short> (v1.0.142)
Node:      v20.x  | Bun: v1.x  | OS: win32 26200

| Tool          | Parity | Savings Δ | Latency Δ (median) | Notes |
|---------------|--------|-----------|--------------------|-------|
| ctx_read      | match  | -0.2pp    | +3%                | OK    |
| ctx_route     | equiv  | +1.4pp    | +8%                | fork adds classifications |
| ctx_execute   | match  | -0.1pp    | +1%                | OK    |
...
```

## Risks

- **Spec-equal but version-skew**: upstream tip moves; pin and re-pin deliberately.
- **Fork-only features confused with regressions**: divergences allowlist must be explicit and reviewed.
- **Fixture drift**: shared corpora live in `tests/fixtures/` (already inherited from upstream) — keep in sync via periodic re-fetch.
- **Network flake**: never hit live HTTP in CI — use canned fixtures.
- **Cache pollution**: each comparison run uses an isolated `CONTEXT_MODE_HOME` / `TMPDIR`.

## Phases

1. **Done**: doc + sibling-checkout helper + stdio MCP runner + per-tool suites (`ctx_read`, `ctx_route`, `ctx_execute`, `ctx_batch_execute`, `ctx_search`, `ctx_fetch_and_index`) + orchestrator + local fixture server + npm scripts.
2. **Next**: Dim 4 fork-value scenarios (parsers, guard, eval, trace, diff, cache, output-budget, fetch-rate-limit).
3. **Then**: CI workflow + nightly comparison + delta-comment bot + baseline pinning at `tests/fixtures/compare-baseline.json`.

## File map

- `docs/fork-vs-upstream-test-plan.md` — this doc
- `tests/compare/runner.ts` — stdio MCP client
- `tests/compare/lib.ts` — shared helpers (canonicalize, parity grade, reporter)
- `tests/compare/suite.ts` — Suite interface
- `tests/compare/fixture-server.ts` — local HTTP fixture server
- `tests/compare/run.ts` — `npx tsx tests/compare/run.ts <suite>`
- `tests/compare/run-all.ts` — orchestrator
- `tests/compare/tools/ctx-{read,route,execute,batch,search,fetch}.ts` — suites
- `scripts/compare/clone-upstream.mjs` — sibling-checkout helper
- `.compare/UPSTREAM_SHA` — pinned upstream SHA (created on first `compare:setup`)
- `docs/fork-divergences.md` — allowlist of intentional behavior deltas (phase 2)
- `.github/workflows/compare-upstream.yml` — CI gate (phase 3)

## npm scripts

| Script | Action |
|--------|--------|
| `compare:setup` | clone + build pinned upstream into `.compare/upstream/` |
| `compare:all` | run every per-tool suite, write per-suite + combined report |
| `compare:workflows` | run all real-life workflow scenarios |
| `compare:stats-validate` | external stat cross-check |
| `compare:full` | `compare:all` + `compare:workflows` + `compare:stats-validate` |
| `compare:read` | `ctx_read` only |
| `compare:route` | `ctx_route` only |
| `compare:execute` | `ctx_execute` only |
| `compare:batch` | `ctx_batch_execute` only |
| `compare:search` | `ctx_search` only |
| `compare:fetch` | `ctx_fetch_and_index` only (local fixture server) |
| `compare:stats` | `ctx_stats`/`ctx_gain`/`ctx_discover` shape parity |
| `compare:value-parsers` | Dim 4 — parser-driven bytes reduction (fork-only) |
| `compare:value-diff` | Dim 4 — `ctx_diff` (fork-only, experimental) |
| `compare:value-trace` | Dim 4 — `ctx_trace` (fork-only, experimental) |

## CI

`.github/workflows/compare-upstream.yml`:

- Triggers: PR to `main`/`next`/`tier2/refactor` touching `src/`, `tests/compare/`, `scripts/compare/`, or `package.json`; nightly at 07:00 UTC; manual `workflow_dispatch`.
- Steps: checkout → install fork → build fork → clone + build upstream → `compare:all` → `compare:workflows` → `compare:stats-validate` → upload `build/compare/` as artifact → PR comment with truncated combined report.
- Workflow inputs (manual dispatch only): `include_workflows`, `include_stats_validate` (both default true).
- Artifact retention: 30 days.
