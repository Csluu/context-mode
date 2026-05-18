# Context-Mode Fork: Agent Project Overview

Date: 2026-05-17
Audience: AI agents and maintainers working in this fork.

## Read This First

This repository is a fork of `mksglu/context-mode`. The fork is turning context-mode from a general MCP context-saving tool into a routing and output firewall for AI coding agents.

The core idea:

1. Agents should not dump broad command output, full files, raw HTML, or giant diffs into the chat.
2. Context-mode should route risky/noisy requests through safer tools.
3. Raw output should be stored outside the model context as redacted sidecars.
4. Agents should be able to prove savings, find bypasses, and recover raw artifacts when needed.

If you are continuing work, start with:

- `docs/rtk-inspired-context-mode-spec.md` for the full design.
- `docs/rtk-spec-completion-audit.md` for what was implemented.
- `docs/rtk-spec-validation-plan.md` for verification gates.
- `docs/FORK_HANDOFF.md` for current status and next work.
- `graphify-out/GRAPH_REPORT.md` if the graph exists and is fresh enough.

## What The Product Does

Context-mode is an MCP server plus hooks, CLI commands, and platform config files. It protects the agent context window by making the model program analysis instead of reading raw data.

Main behavior:

- `ctx_execute` runs code or shell in a sandbox and returns only controlled stdout.
- `ctx_execute_file` processes a file without dumping the file into chat.
- `ctx_batch_execute` runs multiple broad-gather commands, indexes results, then returns search answers.
- `ctx_search` queries the local FTS knowledge base.
- `ctx_fetch_and_index` fetches web content and indexes chunks instead of returning raw HTML.
- Hooks observe tool calls and can recommend or, when explicitly enabled, rewrite low-risk noisy commands.

The fork adds a more explicit router, sidecar store, read facade, analytics, and validation surface.

## Stable Agent-Facing Tools

These tools should be visible by default and are the ones agents should actually use during normal work.

| Tool | Use it for | Important behavior |
| --- | --- | --- |
| `ctx_read` | File exploration, maps, outlines, symbols, bounded slices | Avoids repeated large reads; full mode requires a reason for large files |
| `ctx_route` | Explain how a noisy command should be handled before running it | Does not execute; shows selected rule, safety, parser, and rewrite eligibility |
| `ctx_fetch_run` | List/fetch redacted raw sidecars from prior runs | Prevents rerunning commands just to see full output |
| `ctx_gain` | Savings view for current or historical sessions | Shows kept-out bytes/tokens, sidecars, per-tool latency, and rollups |
| `ctx_discover` | Missed savings and bypass analysis | Classifies native-tool bypasses, hook gaps, and noisy patterns |
| `ctx_doctor` | Diagnostics | Reports runtimes, hooks, router mode, config source, and adapter tier |

Existing stable tools remain important:

- `ctx_execute`
- `ctx_execute_file`
- `ctx_batch_execute`
- `ctx_index`
- `ctx_search`
- `ctx_fetch_and_index`
- `ctx_stats`
- `ctx_upgrade`
- `ctx_purge`
- `ctx_insight`

## Experimental Or Internal Tools

These are hidden unless `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`.

| Tool | Current intent | Status |
| --- | --- | --- |
| `ctx_guard` | Secret/prompt-injection/control-sequence scanner | Real scanner and fixtures exist; mostly pipeline/validation surface |
| `ctx_eval` | Deterministic parser/router/redaction/omission fixture harness | Better as CLI/CI gate than normal agent tool |
| `ctx_trace` | Local trace summaries and why-big analysis | Useful for debugging agent behavior; not public default surface |
| `ctx_diff` | Git-text diff inventory with optional Difftastic fallback | Text/git mode exists; broad semantic mode remains future-scoped |
| `ctx_cache` | Explain cache eligibility and run approved cache canary | Experimental; explicit `tsc --noEmit` canary only |

Do not assume these tools exist during normal agent work. Prefer the stable surface.

## Agent Routing Rules

The intended agent workflow is:

1. For repo-wide architecture or feature location, use Graphify first when `graphify-out/` exists.
2. For exact symbol/reference navigation, use Serena when configured.
3. For broad/noisy command output, use context-mode tools.
4. Use shell only for focused reads, edits, tests, git writes, and small command output.

Preferred decisions:

- Reading a file to edit exact lines: native read is acceptable.
- Reading a file to analyze, summarize, count, or explore: use `ctx_read` or `ctx_execute_file`.
- Running tests, broad `rg`, `git diff`, logs, status summaries: call `ctx_route` first or use `ctx_execute`.
- Needing full raw output from a previous routed run: use `ctx_fetch_run`; do not rerun just to recover output.
- Checking whether context-mode helped: use `ctx_gain`.
- Checking what bypassed context-mode: use `ctx_discover`.

## Architecture Map

Primary runtime entry points:

- `src/server.ts`: MCP server registration and original core tools.
- `src/cli.ts`: CLI surface including `context-mode run`, `route`, `hook test`, eval/cache/diff helpers.
- `src/executor.ts`: sandbox execution, output capture, sidecar integration.
- `src/tools/registry.ts`: shared tool registration path for stable and experimental tools.

New fork module roots:

- `src/routing/`: command classifier, rewrite registry, command coverage manifest, route decision types.
- `src/parsers/`: parser registry and parser contracts.
- `src/filters/`: reusable filter pipeline taxonomy.
- `src/artifacts/`: redacted run sidecar store and redaction helpers.
- `src/read/`: `ctx_read` map/outline/slice/symbol/full implementation and provider metadata.
- `src/config/`: layered config, env handling, project restrictions.
- `src/session/`: session DB, extraction, analytics, local telemetry summary.
- `src/adapters/`: adapter-specific MCP/tool registration and output budgets.
- `src/cache/`: cache explain and experimental serving canary.
- `src/diff/`: git-text diff inventory.
- `src/eval/`: fixture-driven correctness harness.
- `src/guard/`: secret and unsafe-output scanner.
- `src/trace/`: local trace summary.

Hook/runtime paths:

- `hooks/core/routing.mjs`: shared hook routing logic.
- `hooks/codex/*.mjs`: Codex hook shims.
- `hooks/session-*.bundle.mjs`: generated bundles used by hooks.
- `configs/*`: platform-specific routing instructions and hook configs.

Generated bundles are checked in and matter. If TypeScript changes affect runtime, run the build and keep bundle files fresh.

## Safety Model

The fork should preserve command behavior except for reducing or formatting returned output. A rewrite is invalid if it changes command side effects, permission behavior, exit code, cwd, env, stdout/stderr separation, stdin behavior, timeout behavior, signal behavior, PATH resolution, or shell dialect semantics.

Current safeguards:

- Router classifies interactive, TTY, stdin, watch, and long-running commands as classify-only unless a rule explicitly proves safety.
- Hook rewrite is opt-in via `CONTEXT_MODE_ROUTER_MODE=rewrite` or `CONTEXT_MODE_HOOK_REWRITE=1`.
- Fail-open behavior is required for parser/router crashes.
- Raw sidecars are redacted before persistence.
- Tool responses and FTS indexing paths redact known secrets before returning or storing output.
- Sidecar writes are atomic and quota/TTL controlled.
- Output budgets cap returned content by adapter.
- Local trace/analytics are local-only; no external telemetry path is expected.
- Experimental tools are hidden by default.

Spec-only kill switches not implemented as env vars today:

- `CTX_MODE_READ`
- `CTX_MODE_SIDECAR`
- `CTX_MODE_ANALYTICS`

Do not write tests or docs that claim those env vars work until implementation exists.

## Testing Strategy

Use targeted tests when changing one area, and broader gates before considering the fork ready.

Core gates:

```bash
npm run typecheck
npm test
git diff --check
```

Release-quality gates:

```bash
npm run precommit
npm run benchmark:check
npm run eval:fast
npm run guard:fixtures
npm run skip:audit:strict
npm run supply-chain:check
npm run release:reports
```

Full release gate:

```bash
npm run release:verify
```

`release:verify` is expected to fail in a dirty worktree because provenance rejects dirty releases. Use it only when the tree is clean or when preparing a release.

High-risk targeted tests:

| Area changed | Tests to run |
| --- | --- |
| Router/rewrite rules | `vitest run tests/routing tests/hooks/hook-rewrite.test.ts tests/cli/run-command.test.ts` |
| Sidecars/executor | `vitest run tests/artifacts tests/tools/execute-sidecar-integration.test.ts tests/executor.test.ts` |
| `ctx_read` | `vitest run tests/read tests/tools/read.test.ts` |
| Analytics/gain/discover | `vitest run tests/tools/gain.test.ts tests/tools/discover.test.ts tests/session/telemetry-summary.test.ts` |
| Config/env layering | `vitest run tests/config tests/tools/doctor.test.ts` |
| Guard/redaction | `vitest run tests/guard tests/eval && npm run guard:fixtures` |
| Eval harness | `vitest run tests/eval && npm run eval:fast` |
| Cache | `vitest run tests/cache && npm run eval:fast` |
| Release scripts | `vitest run tests/release && npm run supply-chain:check && npm run release:reports` |
| Platform configs/hooks | `vitest run tests/plugins tests/hooks tests/adapters` |

## Live Testing Checklist

When trying the fork in a real agent session:

1. Run `ctx doctor` or `ctx_doctor({ json: true })` and confirm router mode, config source, hooks, and adapter tier.
2. Run a known noisy command through route explain, for example `ctx_route("git diff --stat", explain: true)`.
3. Run a safe command through `ctx_execute` and verify a sidecar appears through `ctx_fetch_run({ list: true })`.
4. Use `ctx_read` on a medium/large file twice and confirm repeated-read collapse.
5. Ask the agent for `ctx gain` after a few routed operations.
6. Ask the agent for `ctx discover` and check whether native tool bypasses or hook gaps are reported.
7. Keep experimental tools hidden unless explicitly testing them.

## Common Mistakes

- Do not add new MCP tools unless agents truly need them every turn. Tool schemas cost context.
- Do not expose scaffolds as stable tools. Keep unstable ideas experimental or CLI-only.
- Do not make hook rewrite default-on.
- Do not auto-rewrite interactive, watch, stdin, install, deploy, or migration commands.
- Do not persist raw stdin or unredacted sidecar content.
- Do not treat ignored docs as committed docs. `docs/*` is ignored except explicit `.gitignore` exceptions.
- Do not trust a green test bar without the skip audit.
- Do not forget bundle drift. The shipped hooks and CLI may use generated bundles.

## Current Confidence

As of the latest validation pass on 2026-05-17:

- `npm test` passed with `93 passed | 21 skipped` test files and `1593 passed | 684 skipped` tests.
- `npm run benchmark:check` passed with 87 percent savings.
- `npm run eval:fast` passed with 8 passed, 0 failed, 0 missing.
- `npm run guard:fixtures` passed.
- `npm run skip:audit:strict` passed with 100 skip markers and 0 manifest issues.
- `npm run supply-chain:check` passed with 244 dependencies scanned.
- `npm run release:reports` passed.
- `git diff --check` passed with only CRLF normalization warnings in config markdown files.

The fork is usable for live testing, but keep rewrite mode opt-in and watch `ctx_gain`/`ctx_discover` closely during real sessions.
