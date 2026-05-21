# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context. Antigravity has NO hooks — these instructions are ONLY enforcement. Follow strictly.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `mcp__context-mode__ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT use

### curl / wget — FORBIDDEN
Do NOT use `curl`/`wget` via `run_command`. Dumps raw HTTP into context.
Use: `mcp__context-mode__ctx_fetch_and_index(url, source)` or `mcp__context-mode__ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — FORBIDDEN
No `node -e "fetch(..."`, `python -c "requests.get(..."` via `run_command`. Bypasses sandbox.
Use: `mcp__context-mode__ctx_execute(language, code)` — only stdout enters context

### Direct web fetching — FORBIDDEN
No `read_url_content` for large pages. Raw HTML can exceed 100 KB.
Use: `mcp__context-mode__ctx_fetch_and_index(url, source)` then `mcp__context-mode__ctx_search(queries)`

## REDIRECTED — use sandbox

### Shell (>20 lines output)
`run_command` ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `mcp__context-mode__ctx_batch_execute(commands, queries)` or `mcp__context-mode__ctx_execute(language: "shell", code: "...")`

### File reading (for analysis)
Reading to **edit** -> view_file/replace_file_content correct for exact edit context. Reading to **analyze/explore/summarize** -> `mcp__context-mode__ctx_read(path, mode: "map" | "outline" | "symbols")`, then `mcp__context-mode__ctx_read(path, mode: "slice", start, end)` for needed ranges. Use `mode: "full"` only with a reason. If `mcp__context-mode__ctx_read` is unavailable, fall back to `mcp__context-mode__ctx_execute_file(path, language, code)`.

### Search (large results)
Use `mcp__context-mode__ctx_execute(language: "shell", code: "grep ...")` in sandbox.

## Tool selection

0. **MEMORY**: `mcp__context-mode__ctx_search(sort: "timeline")` - after resume, check prior context before asking user.
1. **FILE MAPS**: `mcp__context-mode__ctx_read(path, mode)` - first choice for file exploration, repeated reads, symbol maps, outlines, and bounded slices.
2. **ROUTING**: `mcp__context-mode__ctx_route(command, explain: true)` - classify noisy commands before running them; use for `git diff`, tests, broad `rg`, logs, and long shell output.
3. **GATHER**: `mcp__context-mode__ctx_batch_execute(commands, queries)` - runs commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
4. **FOLLOW-UP**: `mcp__context-mode__ctx_search(queries: ["q1", "q2", ...])` - all questions as array, ONE call (default relevance mode).
5. **PROCESSING**: `mcp__context-mode__ctx_execute(language, code)` | `mcp__context-mode__ctx_execute_file(path, language, code)` - sandbox, only stdout enters context.
6. **WEB**: `mcp__context-mode__ctx_fetch_and_index(url, source)` then `mcp__context-mode__ctx_search(queries)` - raw HTML never enters context.
7. **SIDECARS**: `mcp__context-mode__ctx_fetch_run(list: true | latest: true | runId, raw: true)` - retrieve saved raw artifacts. Do not rerun only to see full output.
8. **MEASURE**: `mcp__context-mode__ctx_gain()` for current-session savings; `mcp__context-mode__ctx_discover()` for bypass/noisy-tool audit.
9. **INDEX**: `mcp__context-mode__ctx_index(content, source)` - store in FTS5 for later search.

## Stable MCP tools

| Tool | Use |
|------|-----|
| `mcp__context-mode__ctx_read` | File map/outline/symbols/slice/full. Default for non-edit file inspection. |
| `mcp__context-mode__ctx_route` | Explain routing decision for noisy commands before execution. |
| `mcp__context-mode__ctx_fetch_run` | List/fetch redacted sidecar output created by previous runs. |
| `mcp__context-mode__ctx_gain` | Show current-session context savings from sandbox/index/cache/sidecars. |
| `mcp__context-mode__ctx_discover` | Show missed savings, bypass categories, and noisy tool patterns. |
| `mcp__context-mode__ctx_diff` | Summarize Git changes with inventory, semantic groups, and risk reason codes. |
| `mcp__context-mode__ctx_execute` / `mcp__context-mode__ctx_batch_execute` | Sandbox command/data processing; only selected stdout enters context. |
| `mcp__context-mode__ctx_search` / `mcp__context-mode__ctx_index` / `mcp__context-mode__ctx_fetch_and_index` | Knowledge-base search/index/web ingestion. |

## Experimental tools

`mcp__context-mode__ctx_guard`, `mcp__context-mode__ctx_eval`, `mcp__context-mode__ctx_trace`, and `mcp__context-mode__ctx_cache` are hidden unless `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`. Do not assume they exist during normal agent work. Prefer stable tools above.

## Parallel I/O batches

For multi-URL fetches or multi-API calls, **always** include `concurrency: N` (1-8):

- `mcp__context-mode__ctx_batch_execute(commands: [3+ network commands], concurrency: 5)` — gh, curl, dig, docker inspect, multi-region cloud queries
- `mcp__context-mode__ctx_fetch_and_index(requests: [{url, source}, ...], concurrency: 5)` — multi-URL batch fetch

**Use concurrency 4-8** for I/O-bound work (network calls, API queries). **Keep concurrency 1** for CPU-bound (npm test, build, lint) or commands sharing state (ports, lock files, same-repo writes).

GitHub API rate-limit: cap at 4 for `gh` calls.

## Output

Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `search(source: "label")`.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call `mcp__context-mode__ctx_stats` MCP tool, display full output verbatim. Use session scope by default. |
| `ctx gain` | Call `mcp__context-mode__ctx_gain`, display current-session savings summary. |
| `ctx discover` | Call `mcp__context-mode__ctx_discover`, display bypass/noisy-tool findings. |
| `ctx doctor` | Call `mcp__context-mode__ctx_doctor` MCP tool, run returned shell command, display as checklist. |
| `ctx upgrade` | Call `mcp__context-mode__ctx_upgrade` MCP tool, run returned shell command, display as checklist. |
| `ctx purge` | Call `mcp__context-mode__ctx_purge` MCP tool with confirm: true and explicit scope/session. Warns before wiping knowledge base. |
