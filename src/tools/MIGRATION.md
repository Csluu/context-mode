# Tool extraction migration plan

`src/server.ts` currently inlines 11 MCP tool handlers, totaling ~3000 of its
4006 LOC. This directory hosts the extracted versions. Migration is
incremental — pick one tool per PR, get review, then move the next.

## Current state (server.ts line ranges)

| Tool                 | Line  | Approx LOC | Closure deps (rough)           |
|----------------------|-------|------------|--------------------------------|
| `ctx_execute`        | 1123  | 330        | executor, runtimes, store, trackResponse, indexStdout, getSessionDir |
| `ctx_execute_file`   | 1453  | 146        | executor, runtimes, checkFilePathDenyPolicy, indexStdout |
| `ctx_index`          | 1599  | 135        | store, checkFilePathDenyPolicy, getSessionDir |
| `ctx_search`         | 1734  | 749        | store, getSessionDir, autoMemorySearch |
| `ctx_fetch_and_index`| 2483  | 233        | store, fetchCache, runPool      |
| `ctx_batch_execute`  | 2716  | 183        | runPool, store, executor        |
| `ctx_stats`          | 2899  | 130        | analytics, getSessionDir        |
| `ctx_doctor`         | 3029  | 138        | executor, runtimes, loadDatabase, getDiagnosticAdapter, VERSION, **detectPlatform** (new) |
| `ctx_upgrade`        | 3167  | 140        | pluginRoot, killProcessOnPort, buildNodeCommand, detectPlatform |
| `ctx_purge`          | 3307  | 347        | store, sessionDB, getSessionDir |
| `ctx_insight`        | 3654  | 191        | pluginRoot, insight spawn       |

## Migration steps (per tool)

1. Create `src/tools/<name>.ts` exporting a `ToolDefinition`.
2. Move the handler body. Replace closure-captured globals with `ctx.*`
   parameter accesses where available; for one-off deps, accept them as
   constructor args to a small factory function: `export function makeFoo(deps): ToolDefinition`.
3. In `src/server.ts`, replace the inline `server.registerTool("foo", ...)`
   block with `registerTool(toolContext, makeFoo({...}))`.
4. Drop every `return trackResponse("foo", ...)` inside the handler — the
   registry wraps the response automatically.
5. Run `tests/core/server.test.ts` + the specific tool's test if one exists.

## ToolContext surface

Today `ToolContext` exposes `{ server, pluginRoot, getSessionDir, trackResponse }`.
Add fields only when ≥2 extracted tools need the same thing.

Common additions you'll likely need:
- `store: ContentStore` (used by 6+ tools)
- `executor: PolyglotExecutor` (used by execute/execute_file/batch_execute)
- `runtimes: RuntimeMap` (used by execute/execute_file/doctor)
- `runPool: <T>(jobs, concurrency) => Promise<T[]>` (used by fetch/batch)

Add these once you start moving the heavier tools.

## Recommended order

1. **`ctx_upgrade`** — smallest non-trivial; mostly path resolution and string templating.
2. **`ctx_doctor`** — moderately self-contained; uses test-executor + db probe.
3. **`ctx_stats`** — wraps analytics; pure read path.
4. **`ctx_index`** — single store call.
5. **`ctx_fetch_and_index`** — needs runPool + fetchCache in ToolContext.
6. **`ctx_batch_execute`** — needs everything; do last.
7. **`ctx_execute` / `ctx_execute_file` / `ctx_purge` / `ctx_search` / `ctx_insight`** — biggest handlers, do in any order after foundation.

## Anti-goals

- Do NOT introduce a plugin/auto-discovery system for tools. Static
  imports + an explicit `registerTools(ctx, [a, b, c, ...])` call site
  keep the dependency graph readable. Magic discovery hurts more than it
  helps at 11 tools.
- Do NOT split tool description strings into separate files. The handler
  and its description belong in the same file — that's the unit of
  cognitive change.
