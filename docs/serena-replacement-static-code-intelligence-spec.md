# Serena Replacement: Static Code Intelligence Spec

Status: implemented as default static navigation path
Date: 2026-05-21
Owner: context-mode fork

## Objective

Replace Serena as a default dependency for day-to-day agent code navigation by building a lightweight static code intelligence layer inside Context Mode.

The replacement must make Context Mode better at selecting and returning compact code context. It must not become a language server, semantic refactor engine, or Graphify replacement.

Target shape:

```text
agent task
  -> ctx_read / ctx_search / ctx_code tools
  -> path policy and projectDir boundary
  -> lazy parser provider
  -> hash-cached symbol/import index
  -> compact symbols, slices, probable refs, or context pack
  -> confidence labels and byte budget metadata
```

## Decision Summary

Build the replacement layer in phases. The dedicated removal benchmark now passes for the default static-navigation scope, so Context Mode is the default TS/JS/Rust code-navigation path and Serena remains optional precision fallback only.

The removal decision is split into two tracks:

- Static navigation replacement gate: required before Serena can be disabled as the default code-navigation dependency.
- Context pack advisory gate: valuable follow-up work, but not required for Serena disablement unless the default routing starts depending on `ctx_pack`.

The direction is valid if scoped to:

- static symbol and import extraction
- symbol body/range reads
- probable reference lookup
- explicit confidence labels
- strict project and security boundaries
- budgeted context packs as a later Context Mode enhancement

The direction is invalid if it requires:

- full LSP
- always-on daemon or watcher
- type-aware rename/apply
- semantic diagnostics
- broad project-wide AST retention
- Graphify-like durable architecture graphing

Reference boundary: Context Mode references are textual/import-ranked candidates only. They must not be used for semantic rename/apply decisions, and tool output must not describe them as semantic references.

## Inputs And Evidence

This spec incorporates:

- User feedback batches from 2026-05-20.
- Five independent review lanes:
  - architecture boundaries and YAGNI
  - current repo implementation fit
  - dependency/tooling validation
  - benchmark and Serena-removal criteria
  - operational risk, cache, concurrency, and security
- Existing repo implementation:
  - `src/read/ctx-read.ts` has `ctx_read` modes, a pluggable `CodeMapProvider`, a TypeScript compiler provider, heuristic fallback, provider confidence, file hashes, and compact renderers.
  - `src/store.ts` already uses SQLite/FTS5 for indexed content and file-backed stale refresh, but not a structured symbol/import index.
  - `src/tools/*` and `src/tools/registry.ts` provide the preferred extraction pattern for new tools.
  - `src/server.ts` owns projectDir resolution, path policy integration, response budgets, redaction, and tool registration.
  - `src/db-base.ts` and `src/session/db.ts` already define SQLite WAL, retry, busy timeout, and project hash patterns.

External tooling facts checked before this spec:

- ripgrep is a fast recursive search tool with gitignore support and good Windows support, but should remain an optional accelerator rather than a hard runtime dependency.
- Oxc is a promising JS/TS parser, but current `oxc-parser` Node engine requirements are tighter than this package's declared `node >=22.5.0`; benchmark before making it core.
- Tree-sitter is a good future polyglot parser backend, but adding it core requires grammar packages and native install reliability work.
- ast-grep is useful later for structural search/codemods, not a base index dependency.
- Universal Ctags should not be core because JSON output depends on external build features.
- SQLite FTS5 remains appropriate for text chunks; symbol/import data should use normal SQLite tables.

## Goals

1. Make `ctx_read symbols` and `ctx_read map` strong enough to replace most Serena overview usage for TS/JS files.
2. Add a lazy, per-project code index with file, symbol, import, export, and heading facts.
3. Support symbol search and symbol body reads without launching a language server.
4. Support probable references using import/export facts plus bounded textual search.
5. Add compact context packs for common agent tasks after the static navigation gate is healthy.
6. Keep Graphify as the durable architecture intelligence layer.
7. Provide a reproducible benchmark that decides when Serena can be disabled by default.

## Non-Goals

- Do not build a full LSP replacement.
- Do not build type-aware references.
- Do not apply repo-wide rename automatically.
- Do not run an always-on watcher or daemon.
- Do not keep full ASTs in memory across tool calls.
- Do not index denied or sensitive paths.
- Do not add another generic code graph or architecture graph.
- Do not build a call graph, transitive dependency graph, framework architecture inference layer, cross-language resolver, or subsystem explainer.
- Do not expose a large stable MCP tool surface in the first slice.
- Do not remove Serena based only on token-savings reports.

## Architecture Boundaries

Context Mode owns fresh operational code context:

- file maps
- symbols
- line ranges
- imports/exports
- probable textual/import-ranked refs
- likely tests as an advisory selector, not a semantic proof
- diff/task context packs as post-navigation enhancements
- shell/web/tool-output compression and sidecars

Graphify owns durable architecture memory:

- repo community maps
- cross-module architecture explanations
- durable wiki/docs
- long-range dependency understanding
- historical architectural reports

Serena remains optional for precision-only work:

- exact semantic references
- rename preview/apply
- go-to-definition through aliases
- type/interface implementation lookup
- type-aware unused-code claims

This boundary is intentionally conservative. Anything that requires type flow, alias chasing, interface implementation lookup, or safe repository-wide rename remains outside the static layer until a separate semantic tool proves reliable.

Framework-specific labels such as React component, hook, or route handler are display/classification hints only. They are not routing authority, ownership proof, semantic references, or framework architecture analysis.

## Public Surface Strategy

Keep the stable public MCP surface small.

Phase 1 should improve existing `ctx_read` output and internal helpers. The first new public surface should be one experimental tool, not a cluster of separate tools. This keeps adapter manifests, prompt guidance, and removal benchmarks small enough to validate.

Stable or stable-extension surfaces:

- `ctx_read`
  - stronger `map`
  - stronger `symbols`
  - stronger compact mode
  - optional future symbol-target input only if backward-compatible

Experimental first surface:

- `ctx_code`
  - `action: "find_symbol"`
  - `action: "read_symbol"`
  - `action: "refs_light"`

The individual names `ctx_find_symbol`, `ctx_symbol_read`, and `ctx_refs_light` are contract labels in this spec, not guaranteed public MCP tool names. They may become separate tools only after the consolidated `ctx_code` surface proves too awkward.

Deferred or internal-only surfaces:

- `ctx_pack` is a post-navigation Context Mode enhancement, not a Serena-disablement prerequisite.
- `ctx_diff_context` and `ctx_likely_tests` should remain internal selectors until they have independent contracts and benchmarks.

Promotion rule:

```text
experimental tool -> stable only after:
  schema tests pass
  adapter manifests updated
  output-budget tests pass
  real-repo benchmark proves value
  docs and prompt guidance updated
```

## Data Model

Add a dedicated code-index SQLite store, implemented as `CodeIndexStore extends SQLiteBase`. Keep it separate from `src/store.ts`, which is content/FTS oriented. Add `resolveCodeIndexPath()` beside the existing project hash/session DB helpers so project keying, WAL settings, busy timeout, and retry behavior stay consistent.

Use normal SQLite tables for structured facts. Do not put all symbol data into FTS.

Proposed tables:

```sql
CREATE TABLE code_files (
  project_key TEXT NOT NULL,
  path TEXT NOT NULL,
  real_path TEXT NOT NULL,
  language TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  content_hash TEXT NOT NULL,
  parser TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  config_hash TEXT,
  ignore_hash TEXT,
  indexed_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (project_key, path)
);

CREATE TABLE code_denials (
  project_key TEXT NOT NULL,
  path TEXT NOT NULL,
  real_path_hint TEXT,
  policy_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  denied_at TEXT NOT NULL,
  PRIMARY KEY (project_key, path, policy_hash)
);

CREATE TABLE code_symbols (
  project_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_symbol_id TEXT,
  ordinal INTEGER NOT NULL DEFAULT 0,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_col INTEGER,
  end_col INTEGER,
  range_hash TEXT,
  signature_preview TEXT,
  export_status TEXT NOT NULL DEFAULT 'local',
  confidence TEXT NOT NULL,
  parser TEXT NOT NULL,
  PRIMARY KEY (project_key, file_path, symbol_id)
);

CREATE TABLE code_imports (
  project_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source TEXT NOT NULL,
  imported_name TEXT,
  local_name TEXT,
  line INTEGER NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL
);

CREATE TABLE code_exports (
  project_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  exported_name TEXT NOT NULL,
  local_name TEXT,
  symbol_id TEXT,
  line INTEGER NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL
);

CREATE TABLE code_headings (
  project_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  level INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE code_index_meta (
  project_key TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  last_indexed_at TEXT,
  last_gc_at TEXT
);
```

Indexes:

```sql
CREATE INDEX idx_code_symbols_name ON code_symbols(project_key, name);
CREATE INDEX idx_code_symbols_qualified ON code_symbols(project_key, qualified_name);
CREATE INDEX idx_code_symbols_file ON code_symbols(project_key, file_path);
CREATE INDEX idx_code_imports_source ON code_imports(project_key, source);
CREATE INDEX idx_code_exports_name ON code_exports(project_key, exported_name);
CREATE INDEX idx_code_files_hash ON code_files(project_key, content_hash);
```

Identity rules:

- `symbol_id` must be stable across unchanged files and deterministic across processes.
- Generate it from normalized relative path, parser name, qualified name, kind, parent qualified name, start/end lines, and an ordinal among same-name siblings.
- `qualified_name` should encode containment, such as `ClassName.methodName` or `module.functionName`.
- Overloads, duplicate local functions, and generated declarations must disambiguate with `ordinal`.
- `range_hash` should hash only the symbol range after redaction-safe normalization; it is for stale/oracle detection, not content recovery.

Storage safety rules:

- Store compact facts only. Never store full source text.
- Redact before storing `signature_preview`, headings, import/export text, and any snippet-like field.
- Do not store literal initializers, comments, docstrings, or string values unless a later explicit feature enables them and the redaction pipeline runs before storage and again before output.
- Denied paths must use `code_denials` only. Never write denied rows into `code_files`, and never store denied content hashes, size/mtime facts, previews, symbols, imports, exports, or headings.

Migration rules:

- Use `PRAGMA user_version` or equivalent schema metadata.
- Never `DROP` hot shared tables during normal startup.
- Migrations must be idempotent and safe under concurrent readers.
- If migration fails, disable code index and fall back to `ctx_read` heuristic mode.

## Cache And Invalidation

No watcher in the first implementation.

Index lazily when a tool needs facts:

- `ctx_read map/symbols`
- `ctx_code action=find_symbol`
- `ctx_code action=read_symbol`
- `ctx_code action=refs_light`
- `ctx_pack` after it exists

Cache key must include:

- canonical project root
- canonical file path
- normalized path casing on Windows/macOS
- file size
- mtime
- content hash
- parser name and parser version
- index schema version
- relevant config hash, such as `tsconfig.json` when used
- ignore/exclusion policy hash

Staleness behavior:

- Before returning any indexed fact, re-check file existence, deny status, parser version, schema version, config hash, ignore/exclusion hash, size, mtime, and content hash.
- If file exists and hash is unchanged, reuse facts.
- If file exists and hash changed, parse outside transaction, then re-stat/re-hash immediately before commit and upsert facts only if the parsed version still matches.
- If file was deleted, tombstone or delete facts; do not leave deleted symbols searchable as live results.
- If parser/config/schema changed, reparse affected files.
- If parsing fails, keep old facts only if marked stale and report fallback confidence.
- Do not return stale facts as live results. Stale facts must be explicitly labeled `stale` or replaced by live `ctx_read`/heuristic fallback.

Exclusion policy:

- Apply path deny rules, generated-file checks, binary sniffing, and gitignore/custom ignore policy before reading, hashing, parsing, snippetting, or indexing.
- Include the effective ignore and deny-policy hash in invalidation.
- Default to `.gitignore` semantics for broad search/ref scans; custom allow rules may include otherwise ignored files only when they still pass the sensitive-path deny policy.
- Report omitted counts by reason: denied, ignored, generated, binary, too large, parse failed, budget.

SQLite concurrency:

- Use WAL mode, a busy timeout, and bounded retry/backoff through `SQLiteBase`.
- Parse files outside transactions.
- Use short `BEGIN IMMEDIATE` write batches for upserts and tombstones.
- Use compare-and-swap semantics on content hash, size, mtime, parser version, schema version, and policy hash so a slower old parse cannot overwrite newer facts.
- Serialize migrations with a lock/transaction and make them idempotent.
- If the code-index DB is locked or migration cannot complete, fail open to live `ctx_read`/heuristic output and report the fallback.

## Project And Security Boundaries

Hard rule: code-index tools must never use process cwd as an implicit cross-project root.

Every code-index entrypoint must have an explicit or effective `projectDir`. Legacy `ctx_read` compatibility may use an adapter-attributed project root, but if the effective root is ambiguous the tool must fail closed. `cwd` can narrow command execution, but it is never project root authority.

Requirements:

- Resolve `projectDir` and candidate file paths with native `realpath`.
- Normalize separators for storage keys.
- Case-fold only for keying on case-insensitive platforms.
- Reject post-realpath paths outside the canonical root.
- Reuse existing projectDir override allowlist behavior.
- Reuse `ctx_read` deny policy before opening, hashing, parsing, snippetting, or indexing a file.
- Skip sensitive paths before parsing, not only before returning output.
- Redact before storage and again before output.
- Do not index `.env`, secret config, credentials, `.ssh`, `.aws`, `.kube`, `.git/config`, or denied custom patterns.
- Do not write full file content into the code index.

Windows path tests must cover:

- mixed-case drive letters
- `/c/path` and `C:\path` slash variants
- `..` traversal
- trailing slash variants
- symlinks and junctions
- UNC paths when supported
- `\\?\UNC\...` long UNC variants
- long-path prefixes
- 8.3 short-name aliases
- drive-relative paths such as `C:foo`
- trailing dot/space normalization
- case-insensitive cache key collisions

Default exclusions:

```text
.git
.context-mode
node_modules
dist
build
coverage
generated
vendor
target
out
graphify-out
*.min.js
*.bundle.js
*.map
package-lock.json
pnpm-lock.yaml
yarn.lock
bun.lock
bun.lockb
binary files
files above configured max bytes
```

## Parser Provider Plan

### Provider Stage A: Current TypeScript Provider

Use the existing `ts.createSourceFile` provider as the first serious backend.

Improve `CodeMapSymbol` with:

```ts
interface CodeMapSymbol {
  line: number;
  endLine: number;
  kind: string;
  text: string;
  name?: string;
  detail?: string;
  parentName?: string;
  exportStatus?: "local" | "exported" | "default-export";
  confidence?: "high" | "medium" | "low";
}
```

Add extraction for:

- import specifiers
- export specifiers
- top-level functions
- classes
- methods
- interfaces
- type aliases
- enums
- React component-like functions
- hook-like functions
- route handler-like functions where syntax is obvious
- line ranges

Do not do type inference or semantic resolution.

Phase 1 dependency gate:

- The current provider imports `typescript`, but `typescript` is a devDependency.
- Before shipping TS/JS static parsing as a packaged default feature, choose one of:
  - promote TypeScript to a runtime dependency with an explicit installed-size budget,
  - keep TypeScript dynamic/opportunistic and prove packaged installs work without it,
  - bundle/externalize deliberately and document the runtime behavior.
- Fresh package install tests must cover `npm pack`, global install, and installs without dev dependencies.
- If TypeScript is absent, output must fall back to the heuristic provider with a clear diagnostic instead of crashing.

### Provider Stage B: Oxc Benchmark Candidate

Do not add Oxc as core until benchmarked and until Node engine compatibility is resolved.

Benchmark against TypeScript provider for:

- parse speed
- TSX/JSX fidelity
- import/export extraction
- symbol line ranges
- syntax-error tolerance
- Node engine compatibility
- Windows install behavior
- bundle size and package impact

Blocker:

- Current `oxc-parser` engine requirements are tighter than this repo's declared Node engine range.
- Oxc cannot enter runtime dependencies until the repo raises its supported Node engine, a compatible parser package is chosen, or Oxc is kept isolated to dev/benchmark experiments.

### Provider Stage C: Tree-sitter Polyglot Candidate

Defer Tree-sitter until TS/JS indexing is stable.

Use only for bounded syntax extraction:

- functions
- classes
- methods
- imports
- exports
- headings where language supports it
- line ranges

Do not expose raw AST.
Do not keep ASTs in memory.
Do not build semantic refs from Tree-sitter alone.

Tree-sitter acceptance gates before adding any runtime package:

- Pin the exact language grammar package list and versions.
- Prove Windows install from a packed package without requiring build tools.
- Record installed-size impact.
- Add smoke tests for each grammar.
- Keep unsupported languages on heuristic fallback.

Optional structural tools:

- ast-grep may become an optional structural-search adapter after size/install tests, but it is not a base index dependency.
- Universal Ctags may be probed at runtime only when installed and JSON-capable; it must never be required.
- SCIP/LSIF/Kythe/CodeQL remain out of scope for this lightweight layer.

### Fallback: Heuristic Provider

The heuristic provider remains mandatory.

If parser load, parse, or grammar lookup fails:

- return best-effort symbols
- set confidence `low`
- include diagnostic metadata
- do not fail the user workflow

## Confidence Model

Every nontrivial code-navigation result must include confidence.

Suggested labels:

```text
high
  syntax parser found exact declaration/range in current file
  symbol body read uses exact indexed range

medium
  import/export graph suggests relationship
  same package/module plus exact identifier match
  parser fallback found plausible declaration

low
  raw textual match only
  fuzzy/BM25 match only
  regex heuristic in unsupported language
```

Reference labels:

```text
definition
  declaration location from parser index

import-ranked
  textual match in a file that imports the defining module or exported symbol

same-file
  textual match in same file as definition

textual
  exact word match from bounded search with no import evidence

fuzzy
  approximate text/search result
```

The tool must not call `textual` or `import-ranked` hits "semantic references."

## Tool Contracts

### `ctx_read` Extensions

Phase 1 extends existing modes.

`ctx_read({ mode: "symbols" })` should return:

- provider
- confidence
- parser version when available
- symbol count
- imports/exports summary
- names and line ranges
- compact signatures
- omitted count

`ctx_read({ mode: "map" })` should return:

- file role guess
- line count and byte count
- imports count and key imports
- exports count and key exports
- top-level symbols with ranges
- suggested slices
- generated/minified warning when applicable

Budget:

- compact default target: 1-3 KB
- normal default target: 5-8 KB
- hard max: existing adapter response budget or explicit lower cap
- verbose/debug only when requested
- per-result snippets must be dropped before redaction/budget uncertainty can exceed the cap

### `ctx_code`

Purpose:

Expose static navigation through one small stable surface. This is the default MCP surface for the Serena static-navigation replacement path.

Input:

```ts
type CtxCodeAction = "find_symbol" | "read_symbol" | "refs_light";

interface CtxCodeInput {
  action: CtxCodeAction;
  projectDir: string;
  query?: string;
  symbol?: string;
  file?: string;
  pathGlob?: string;
  kind?: string;
  limit?: number;
  budgetBytes?: number;
  includeImports?: boolean;
  includeDocs?: boolean;
  confidenceFloor?: "high" | "medium" | "low";
  compact?: boolean;
}
```

Effective `projectDir` is mandatory after adapter/project resolution. Legacy callers may omit it only when the adapter has already attached an unambiguous project root.

Action: `find_symbol`

- Find declarations by name without launching Serena/LSP.
- Return names, kinds, file paths, ranges, export status, confidence, and freshness.
- Default budget: 3 KB. Hard max: 8 KB unless the adapter has a lower cap.
- Default limit: 10. Always report omitted counts.

Example output shape:

```text
ctx_code find_symbol: <query>
provider: code-index
freshness: checked <n> files, reused <n>, parsed <n>

HIGH file.ts:12-45 function resolveGatewayConfig export
MED  src/foo.ts:80-92 function resolveConfig local

omitted: <n>
```

Action: `read_symbol`

- Resolve a symbol via the index.
- If multiple matches exist, return compact disambiguation unless `file` narrows it.
- Delegate final source read to `ctxRead(... mode: "slice")` so existing path policy, redaction, and slice rendering apply.
- Include imports/docs only inside budget.
- Default budget: 6 KB. Hard max: 16 KB unless the adapter has a lower cap.

Action: `refs_light`

- Find likely references using static facts plus bounded text search.
- Search with a Node fallback and optionally use `rg` when available.
- Rank same-file hits, files importing the defining file/module, files importing the exported symbol, same-package/directory hits, then raw textual matches.
- Return grouped `definition`, `same-file`, `import-ranked`, `textual`, and `fuzzy` candidates with confidence labels.
- Default budget: 6 KB. Hard max: 16 KB unless the adapter has a lower cap.

`refs_light` must not claim semantic truth. It returns textual/import-ranked candidates only and must refuse or label low-confidence semantic-only cases such as alias chains, interface implementations, type-only references, and rename-preview decisions.

### `ctx_pack` (post-navigation experimental)

Purpose:

Build one budgeted context bundle for a task, symbol, file, diff, or failing test.

This is a broader Context Mode enhancement. It is not required to disable Serena for static navigation unless default routing begins depending on it.

Input:

```ts
interface CtxPackInput {
  projectDir: string;
  task?: string;
  symbol?: string;
  file?: string;
  diff?: boolean;
  includeTests?: boolean;
  includeGraphifyPointers?: boolean;
  budgetBytes?: number;
  compact?: boolean;
}
```

Output sections:

- task summary
- selected files
- relevant symbols
- exact slices
- probable refs
- likely tests
- recent diff hunk summary
- Graphify pointer if `graphify-out` exists
- omissions and budget used
- confidence distribution

Budget rules:

- Enforce during assembly, not only in final `trackResponse`.
- Reserve bytes for omissions/warnings.
- Default budget: 8 KB.
- Hard max: adapter budget or explicit lower cap.
- Never include raw full files.
- Every included slice must have path-policy approval.
- Drop snippets rather than exceed budget or skip redaction.

## Context Pack Selection Strategy

`ctx_pack` should compose existing primitives rather than invent a new reasoning engine.

Candidate selection order:

1. Exact user-specified file or symbol.
2. Current git diff touched files and changed symbols.
3. Failing test/log terms from recent sidecars.
4. Symbol index matches.
5. Import/export neighbors.
6. Likely tests.
7. Graphify pointer only, not full architecture dump.

Omission policy:

- Prefer fewer higher-confidence files over many weak matches.
- Prefer symbol slices over whole-file maps.
- Prefer nearby tests over broad test directories.
- Report omitted counts by reason.

## Benchmark: Serena Removal Gate

Current `compare:real-repos` is only a smoke test. It is not a Serena-removal benchmark.

Add a dedicated `compare:serena-removal` lane with its own result types. Do not force this benchmark into the existing fork/upstream token-row shape.

### Navigation Removal Gate

This gate decides whether Serena can be disabled as the default dependency for static code navigation.

Benchmark config must be a committed artifact, not local path prose:

```json
{
  "version": 1,
  "repos": [
    {
      "name": "mission-control",
      "url": "<mission-control-git-url>",
      "pathOverrideEnv": "CONTEXT_MODE_BENCH_MISSION_CONTROL",
      "requiredRemote": "origin",
      "requiredSha": "<pinned-sha>",
      "oracleFile": "tests/compare/oracles/mission-control.json"
    },
    {
      "name": "widget-launcher",
      "url": "<widget-launcher-git-url>",
      "pathOverrideEnv": "CONTEXT_MODE_BENCH_WIDGET_LAUNCHER",
      "requiredRemote": "origin",
      "requiredSha": "<pinned-sha>",
      "oracleFile": "tests/compare/oracles/widget-launcher.json"
    },
    {
      "name": "public-fixture",
      "url": "<public-fixture-git-url-or-archived-snapshot>",
      "pathOverrideEnv": "CONTEXT_MODE_BENCH_PUBLIC_FIXTURE",
      "requiredRemote": "origin",
      "requiredSha": "<pinned-sha>",
      "oracleFile": "tests/compare/oracles/public-fixture.json"
    }
  ]
}
```

Local paths such as `C:\Users\chris\Documents\GitHub\mission-control-master` are examples only. The benchmark must read repo locations from config/env, record actual SHA/remote/dirty state, and block if identity does not match the oracle. At least one public pinned fixture repo or archived snapshot must be runnable in CI without private local paths.

Required lanes:

- raw native
- Context Mode static layer
- Serena
- best-of Context Mode + Serena

Live Serena runner contract:

- Discover Serena tools and record tool names, tool schema version when available, startup status, and project activation status.
- Record Serena version or command identity when available.
- Map each Serena-applicable scenario to a concrete Serena call, such as overview, find symbol, or find references.
- Normalize Serena output into the same scenario-row shape as Context Mode: files, symbols, ranges, bytes, latency, confidence/applicability, and oracle verdict.
- Block removal when any Serena-applicable required scenario lacks a live Serena row.
- Historical Serena-derived rows may appear as secondary context only; they cannot replace the live baseline.

Required run modes:

- first-index cold run with isolated `CONTEXT_MODE_HOME`
- warm same-process run
- cache-hit repeated run

Timing methodology:

- Record machine metadata: OS, CPU model, RAM, Node version, package version, parser versions, and Serena version.
- Use a fixed warmup policy and sample count per scenario.
- Separate Serena startup time from warm query time, but report both.
- Report p50/p90/p95 for first-index, warm-process, and cache-hit modes.

Required scenarios:

| Scenario | Expected Behavior |
| --- | --- |
| Symbol lookup | Find known symbols by name in both repos. |
| Symbol body read | Return exact body/range for known symbols. |
| File outline | Return compact imports/exports/top-level symbols for known files. |
| Likely refs | Return expected files in top results with explicit non-semantic labels. |
| Explicit static entry lookup | Locate files from explicit static facts such as filename, exported symbol, route literal, or import neighbor. |
| Semantic-control negative | Refuse or label low-confidence cases that require LSP/Serena semantics. |

Semantic-control examples:

- alias chains: `low` or `medium` static candidates only, never semantic references
- barrel re-exports: `medium` static candidates only, never semantic references
- duplicate symbols and overloads
- interface implementations: hard refusal or Serena-required classification
- type-only references: hard refusal or low-confidence textual candidates
- rename-preview or rename-apply requests: hard refusal

Oracle fixtures must be versioned per repo and scenario. Each fixture should include:

```json
{
  "scenarioId": "symbol-body-history-pane",
  "repoName": "mission-control",
  "repoSha": "<pinned-sha>",
  "query": "HistoryPane",
  "expected": {
    "file": "src/...",
    "symbol": "HistoryPane",
    "kind": "function",
    "startLine": 10,
    "endLine": 88,
    "bodyHash": "sha256:...",
    "requiredTopFiles": ["src/..."],
    "forbiddenFiles": ["dist/..."],
    "expectedTests": ["..."],
    "quality": {
      "minTop1": 1,
      "minTop3": 1,
      "minMRR": 1,
      "maxFalsePositives": 0,
      "maxIrrelevantBytes": 512,
      "requiredConfidenceLabels": ["high"],
      "forbiddenPhrases": ["semantic reference"]
    },
    "provenance": {
      "source": "manual|raw-native|serena-corroborated",
      "reviewer": "<name-or-handle>",
      "createdAt": "<iso-date>",
      "validationCommand": "<command that checks files/ranges/hashes directly from the pinned repo>"
    }
  }
}
```

Oracle provenance rules:

- Oracles must not be generated solely from Context Mode output.
- A validator must independently check expected files, ranges, and hashes from the pinned repo using raw filesystem/git reads.
- Manual review or Serena/raw-native corroboration must be recorded in the fixture.
- Stale or provenance-missing oracles are non-waivable blockers.

Quality metrics:

- top-1 and top-3 recall
- MRR or nDCG for ranked outputs
- max false-positive count
- max irrelevant returned bytes
- body-range hash match for symbol reads
- required expected files present
- forbidden files absent
- confidence labels present and honest
- per-scenario thresholds must come from the oracle/config, not from post-run tuning

Payload and speed metrics:

- raw bytes/tokens
- returned bytes/tokens
- saved percent vs raw
- delta vs Serena
- first-index/warm/cache p50/p90/p95
- cache hit count
- provider name and confidence for every Context Mode row
- packaged-install versus dev-checkout runner identity
- omitted counts by reason
- confidence distribution

Machine-readable report schema:

```json
{
  "decision": "pass|block",
  "blockers": [],
  "waivers": [],
  "repoIdentity": [],
  "toolVersions": {},
  "scenarioRows": [],
  "oracleFailures": [],
  "exitCode": 0
}
```

The CLI must exit nonzero on `decision: "block"`.

Minimum pass bars:

- Both configured real repos present and identity-matched.
- Repos pinned by SHA and dirty state captured.
- Live reproducible Serena baseline exists.
- Required oracle fixtures exist and match the pinned repo SHAs.
- Required oracle fixtures have independent provenance and pass validator checks.
- No required scenario skipped.
- 100 percent oracle pass on required navigation scenarios.
- Per-scenario quality bars pass, not only aggregate quality.
- Context Mode static quality is Serena-equivalent or better on non-semantic navigation scenarios.
- Cached p90 <= 1000 ms for lookup/body/refs/entry-point scenarios.
- Context Mode savings vs raw >= 80 percent aggregate.
- Each real workflow saves >= 60 percent unless waived with evidence.
- Context Mode no worse than 1.25x Serena bytes on green Serena-applicable static-navigation steps, unless extra bytes are required facts.
- Reference recall includes all hand-labeled expected files in top-3 and keeps false positives under the scenario cap.
- If best-of Context Mode + Serena materially beats Context Mode-only on required static navigation scenarios, default disablement blocks or is scoped more narrowly.

Non-waivable blockers:

- missing repo
- missing Serena baseline
- missing/stale oracle fixture
- oracle not tied to repo SHA
- skipped required scenario
- denied/sensitive path included
- stale-cache result after mutation or deletion
- semantic-only control overclaimed as semantic
- tool output lacking confidence labels
- missing provider name/confidence in Context Mode rows
- dev-checkout-only pass when packaged/global install subset fails

Waivers must include reason, owner, expiry date, affected scenario, and why default Serena disablement remains safe. They cannot waive missing repo, missing Serena, missing oracle, oracle failures, or sensitive-path leaks.

Serena disablement is initially scoped to TS/JS navigation unless polyglot parser benchmarks pass the same gate for additional languages.

### Context Pack Advisory Gate

This gate validates `ctx_pack`, diff context, and likely-test selection. It is useful but separate from Serena default disablement.

Advisory scenarios:

| Scenario | Expected Behavior |
| --- | --- |
| Bug context pack | Given failing test/log text, return implicated file, symbol, and test command. |
| Diff impact/tests | Given synthetic or real diff, return changed symbols, import neighbors, and likely tests. |
| Task pack | Given a bug/feature prompt, return bounded file maps, slices, refs, tests, and Graphify pointers. |
| Feature entry point | Given a feature prompt, locate likely frontend/backend entry files and include Graphify pointers when available. |

Passing this gate can promote `ctx_pack`, but failing it must not block static-navigation removal unless the product starts routing default code navigation through `ctx_pack`.

## Serena Disablement Plan

Do not remove Serena support abruptly.

Sequence:

1. Keep Serena optional and documented.
2. Treat `ctx_code` as the default static navigation tool for TS/JS/Rust symbol lookup, symbol reads, refs-lite, related files, likely tests, and context packs.
3. Do not require Serena for default Context Mode health.
4. Keep "use Serena for exact semantic refactor" guidance until a separate semantic-refactor gate says otherwise.
5. Keep the Serena removal benchmark as a regression gate, including the direct Serena row runner when available.
6. Remove Serena-specific guidance only after at least one release cycle with no regression reports.

## Implementation Phases

### Phase 0: Pre-Flight Fixes

Fix known review findings before building the replacement layer:

- Exclude `real-repos-*.json` from token per-tool ingestion and validate row shape.
- Fix pytest route overmatch so `echo pytest` is not routed as pytest.
- Teach the `gh` parser to summarize JSON object output.

Verification:

- Targeted parser/routing tests.
- `compare:real-repos` followed by `compare:tokens` must not produce `undefined` tool/scenario rows.

### Phase 1: Strengthen `ctx_read` Symbols And Map

Files likely touched:

- `src/read/code-map.ts` (new shared parser/fact model)
- `src/read/ctx-read.ts`
- `src/tools/read.ts`
- `tests/read/ctx-read.test.ts`
- `tests/tools/read.test.ts`

Tasks:

- Extract the current code-map/provider logic from `ctx-read.ts` into `src/read/code-map.ts` so `ctx_read` and the future index consume the same parser facts.
- Extend symbol model with `endLine`, parent/container, export status, signature preview, confidence.
- Improve TypeScript provider import/export extraction.
- Resolve the TypeScript runtime dependency gate: runtime dependency, dynamic/opportunistic provider, or documented fallback.
- Add generated/minified/binary/lockfile detection to map/symbol output.
- Add stronger compact/normal output contracts.
- Keep heuristic fallback.

Verification:

- Golden tests for TS, TSX, JS, JSX.
- Broken-code fixture.
- Minified/generated fixture.
- Compact byte-budget regression.
- Packaged install smoke test for the chosen TypeScript provider behavior.

### Phase 2: Internal Symbol Index Store

Files likely touched:

- `src/read/read-policy.ts` or equivalent shared authorization/open/redaction helper
- `src/read/code-map.ts`
- `src/read/symbol-index.ts`
- `src/read/symbol-index-store.ts`
- `src/session/db.ts` for `resolveCodeIndexPath()` and project-key reuse
- `src/db-base.ts` via `CodeIndexStore extends SQLiteBase`
- `tests/read/symbol-index*.test.ts`

Tasks:

- Add a shared read authorization/open/redaction helper before adding index writes. It must accept the same effective deny policy used by `src/tools/read.ts`/`src/server.ts` and must authorize before open/hash/parse.
- Add schema and migrations.
- Add stable `symbol_id` and `qualified_name` generation.
- Add canonical project/file keying.
- Add file exclusions.
- Extract or inject reusable path-policy checks; do not import `src/server.ts` from index code.
- Store code-index DBs under an adapter/session-isolated sibling of the existing content store, such as `code-index`, via `resolveCodeIndexPath()`. Define cleanup behavior beside existing content/session cleanup.
- Phase 2 MVP is lazy per-file/per-symbol indexing only: no eager whole-repo crawl, no unbounded fanout, no durable architecture traversal, and no transitive graph walk.
- Parse outside transaction.
- Upsert compact rows in short transaction.
- Add stale/deleted/config invalidation.
- Add redaction-before-storage and redaction-before-output checks.

Verification:

- Multi-process writer test.
- Windows path canonicalization test.
- Deleted file tombstone test.
- Sensitive path denial test.
- Deny-before-open/hash/parse test using the same effective policy as `ctx_read`.
- Parser-version invalidation test.
- Gitignore/custom-deny invalidation test.

### Phase 3: Experimental Static Navigation Tools

Files likely touched:

- `src/tools/code.ts`
- `src/tools/registry.ts`
- `src/server.ts`
- `src/adapters/openclaw/mcp-tools.ts`
- OpenClaw bridge manifests/contracts
- Pi/OpenCode schema regression fixtures

Tasks:

- Add stable `ctx_code` with `find_symbol`, `read_symbol`, and `refs_light` actions.
- Keep only semantic refactor operations outside the default static path.
- Update OpenClaw manual bridge registry/manifests explicitly.
- Add Pi/OpenCode schema regression tests.
- Add adapter schemas and docs for the consolidated surface.
- Update `OPENCLAW_BRIDGE_TOOL_DEFS` and manifest mapping for `ctx_code`.

Verification:

- MCP schema tests.
- `tests/plugins/openclaw-tool-schema.test.ts`
- Tool output golden tests.
- Path policy tests.
- Output-budget tests.
- Real fixture repo tests.
- Low-confidence semantic-control tests for alias/re-export/rename-preview cases.

### Phase 4: Serena Removal Benchmark

Files likely touched:

- `tests/compare/serena-removal.ts`
- `tests/compare/serena-removal-types.ts`
- `tests/compare/oracles/*`
- `tests/compare/serena-removal.config.json`
- `tests/compare/run-tokens.ts`
- `tests/compare/research-report.ts`
- `tests/compare/workflows/*`
- `package.json`

Tasks:

- Add configured real-repo benchmark.
- Add `compare:serena-removal` npm script and wire it into compare reporting.
- Use dedicated Serena-removal result types and reports.
- Add versioned oracle fixtures tied to repo SHA.
- Add reproducible Serena baseline collection.
- Run the benchmark, or a blocking oracle subset, from a packed/global install with dev dependencies omitted and record provider name/confidence.
- Add cold/warm/cached timing.
- Add hard oracles.
- Add removal-decision banner.
- Add machine-readable blocker/waiver schema and nonzero exit on block.

Verification:

- Run on both real repos.
- Reports include pass/block and blocker reasons.
- Missing repo/tool causes block.
- Negative controls prove semantic-only cases are refused or labeled low confidence.

### Phase 5: `ctx_pack` Post-Removal Enhancement

Files likely touched:

- `src/tools/pack.ts`
- `src/read/context-pack.ts`
- `src/tools/registry.ts`
- `src/server.ts`
- tests for budget assembly

Tasks:

- Compose task/file/symbol/diff packs.
- Include likely tests and sidecar summaries.
- Include Graphify pointer only.
- Enforce budgets during assembly.
- Report omissions and confidence distribution.

Verification:

- Pack stays under budget.
- Pack does not include denied paths.
- Pack does not include full files.
- Pack handles missing index gracefully.
- Advisory benchmark passes before promotion to stable.

### Phase 6: Parser Expansion

Only after TS/JS static layer is proven:

- Benchmark Oxc.
- Consider Tree-sitter for selected languages.
- Consider ast-grep for structural search.
- Keep ctags optional or rejected.
- For each new runtime dependency, run `npm pack`, fresh install, `--omit=optional`, Windows global install, and fallback diagnostics tests.
- Update or rationalize lockfiles before dependency changes. The package metadata says `pnpm`, while the repo currently carries non-pnpm lockfiles; dependency work must align policy before adding parser packages.
- Run install/import tests on the package's minimum supported Node engine and on current LTS/current Node, or raise the engine requirement in the same PR.

## Documentation Updates Required

Update:

- `README.md`
- `CLAUDE.md`
- `configs/codex/AGENTS.md`
- `configs/openclaw/AGENTS.md`
- platform support docs
- `ctx_doctor` docs
- compare report docs

Messaging:

- Context Mode static code tools are default for cheap local navigation.
- The Serena removal benchmark has passed for the default static-navigation scope.
- `ctx_code` is stable for TS/JS/Rust static navigation.
- `ctx_pack` is a broader context-assembly feature, not the first Serena-removal requirement.
- Serena is optional precision fallback for semantic refactors only.
- Graphify remains architecture intelligence.
- Refs are probable unless explicitly labeled semantic.

## Test And Verification Matrix

Required gates per phase:

```text
Phase 0:
  targeted parser/routing tests
  compare:real-repos
  compare:tokens no undefined rows

Phase 1:
  ctx-read unit tests
  compact output byte-budget tests
  packaged install smoke test for parser dependency behavior
  tsc --noEmit

Phase 2:
  symbol index unit tests
  stale/deleted invalidation tests
  multi-process SQLite tests
  sensitive path tests
  realpath/projectDir boundary tests
  gitignore/custom deny hash invalidation tests
  redaction-before-storage tests

Phase 3:
  MCP schema tests
  tool contract golden tests
  adapter manifest tests
  OpenClaw bridge registry tests
  low-confidence semantic-control tests

Phase 4:
  compare:serena-removal
  packaged/global install oracle subset with dev dependencies omitted
  oracle fixture validation
  machine-readable blocker schema validation
  compare:tokens
  compare:research

Phase 5:
  context-pack budget tests
  denied-path pack tests
  real workflow pack tests
```

Always run before claiming completion:

- `npx.cmd tsc --noEmit`
- `npm.cmd run typecheck:compare`
- targeted Vitest for changed areas
- `ctx_doctor`
- `ctx_gain`
- `ctx_discover`

Dependency/package gates before adding Oxc, Tree-sitter, ast-grep, or any optional parser package:

- `npm.cmd pack`
- fresh install from packed artifact
- install with optional dependencies omitted where applicable
- Windows global install from packed artifact in a path with spaces
- generated `.cmd` shim execution check
- postinstall success check
- native/optional parser fallback check under `--omit=optional`
- Node matrix at the declared minimum engine and current LTS/current
- runtime fallback diagnostic test

## Resolved Decisions And Phase Gates

These decisions replace open-ended questions. If implementation evidence contradicts one, update this section in the same PR as the code change.

1. TypeScript parser dependency:
   - Phase 1 default: keep the TypeScript provider opportunistic unless packaged-install tests prove promoting `typescript` to runtime dependency is acceptable.
   - Promoting `typescript` to runtime dependency is parser dependency work and must satisfy the same lockfile/package-manager policy as Oxc or Tree-sitter.
   - Required behavior when `typescript` is unavailable: fall back to the heuristic provider, mark confidence `low`, and include a compact diagnostic.
   - Reopen trigger: TS/JS benchmark quality falls below the Serena removal pass bar because the provider is unavailable in packaged installs.
2. Code index storage:
   - Use a separate `CodeIndexStore extends SQLiteBase`.
   - Add `resolveCodeIndexPath()` in the session DB/project-key area.
   - Do not merge symbol tables into the existing content/FTS store in the first implementation.
3. First public surface:
   - Ship one stable `ctx_code` tool with actions `find_symbol`, `read_symbol`, and `refs_light`.
   - Split into separate public tools only after benchmark or adapter evidence shows the consolidated action API is causing real usage problems.
4. Path aliases and barrel exports:
   - Represent them as static import/export facts and `medium` confidence candidates.
   - Do not claim semantic reference resolution.
   - Semantic-control benchmarks must prove these cases are refused or labeled low/medium, not overclaimed.
5. `ctx_pack` budget:
   - Default budget: 8 KB.
   - Hard max: adapter budget or explicit lower cap.
   - Promotion requires the separate Context Pack Advisory Gate.
6. Serena baseline runner:
   - The removal gate must use a live, reproducible Serena run when Serena is available.
   - If Serena MCP transport fails, the benchmark decision is `block`, and the report must record the failure as a non-waivable blocker.
   - Existing historical Serena-derived rows may be shown as secondary context, but they cannot substitute for the live baseline.
7. Dependency and lockfile policy:
   - Do not add Oxc, Tree-sitter, ast-grep, ctags integration, or parser packages until package-manager/lockfile policy is clarified.
   - Parser dependency PRs must update the lockfile policy, package install tests, and fallback diagnostics together.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Tool sprawl | Confusing public MCP surface | Experimental gate new tools; promote only after benchmark. |
| Context pack floods output | Defeats Context Mode purpose | Enforce budgets during assembly and test byte caps. |
| Index crosses project boundary | Wrong or leaked context | Require/canonicalize `projectDir`; project-keyed DB. |
| Sensitive file parsing | Secret exposure | Reuse deny policy before opening files. |
| Stale symbol facts | Wrong edits | Hash/config/parser invalidation and tombstones. |
| SQLite contention | Multi-terminal flakiness | Parse outside transactions; short WAL writes; retry/fail-open. |
| Overclaiming refs | Bad refactors | Confidence labels; no semantic rename apply. |
| Oxc/Tree-sitter dependency friction | Install failures | Benchmark/defer; keep TypeScript/heuristic fallback. |
| TypeScript dependency mismatch | Packaged installs crash or silently lose parsing | Make runtime dependency behavior a Phase 1 gate and test packed installs. |
| Advisory context packs block removal | Serena replacement stalls behind broader Context Mode work | Keep navigation removal gate separate from `ctx_pack` promotion. |
| Graphify overlap | Duplicated architecture engine | Context Mode returns pointers, not architecture graph summaries. |

## Final Gate

Serena can be disabled by default only when:

```text
Phase 0-4 complete
compare:serena-removal passes
packaged/global install oracle subset passes with dev dependencies omitted
both real repos are included
one public pinned fixture repo or archived snapshot is included
live Serena baseline exists
required oracle fixtures match repo SHAs
oracle provenance and validator checks pass
100 percent oracle pass
semantic-only negative controls do not overclaim
provider name/confidence recorded for every Context Mode row
cached p90 target met
Context Mode byte savings target met
doctor/docs/configs updated
rollback path documented
```

Until then, the correct product position is:

```text
Context Mode first for static local code context.
Context packs after the navigation layer is proven.
Graphify for durable architecture intelligence.
Serena optional for exact semantic operations and benchmark comparison.
```
