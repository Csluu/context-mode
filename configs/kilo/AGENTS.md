# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `context-mode_ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT attempt

### curl / wget — BLOCKED
Shell `curl`/`wget` intercepted and blocked. Do NOT retry.
Use: `context-mode_ctx_fetch_and_index(url, source)` or `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — BLOCKED
`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, `http.request(` — intercepted. Do NOT retry.
Use: `context-mode_ctx_execute(language, code)` — only stdout enters context

### Direct web fetching — BLOCKED
Use: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)`

## REDIRECTED — use sandbox

### Shell (>20 lines output)
Shell ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `context-mode_ctx_batch_execute(commands, queries)` or `context-mode_ctx_execute(language: "shell", code: "...")`

### File reading (for analysis)
Reading to **edit** -> reading correct for exact edit context. Reading to **analyze/explore/summarize** -> `context-mode_ctx_read(path, mode: "map" | "outline" | "symbols")`, then `context-mode_ctx_read(path, mode: "slice", start, end)` for needed ranges. Use `mode: "full"` only with a reason. If `context-mode_ctx_read` is unavailable, fall back to `context-mode_ctx_execute_file(path, language, code)`.

### grep / search (large results)
Use `context-mode_ctx_execute(language: "shell", code: "grep ...")` in sandbox.

## Tool selection

0. **MEMORY**: `context-mode_ctx_search(sort: "timeline")` - after resume, check prior context before asking user.
1. **FILE MAPS**: `context-mode_ctx_read(path, mode)` - first choice for file exploration, repeated reads, symbol maps, outlines, and bounded slices.
2. **ROUTING**: `context-mode_ctx_route(command, explain: true)` - classify noisy commands before running them; use for `git diff`, tests, broad `rg`, logs, and long shell output.
3. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` - runs commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
4. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` - all questions as array, ONE call (default relevance mode).
5. **PROCESSING**: `context-mode_ctx_execute(language, code)` | `context-mode_ctx_execute_file(path, language, code)` - sandbox, only stdout enters context.
6. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` - raw HTML never enters context.
7. **SIDECARS**: `context-mode_ctx_fetch_run(list: true | latest: true | runId, raw: true)` - retrieve saved raw artifacts. Do not rerun only to see full output.
8. **MEASURE**: `context-mode_ctx_gain()` for current-session savings; `context-mode_ctx_discover()` for bypass/noisy-tool audit.
9. **INDEX**: `context-mode_ctx_index(content, source)` - store in FTS5 for later search.

## Stable MCP tools

| Tool | Use |
|------|-----|
| `context-mode_ctx_read` | File map/outline/symbols/slice/full. Default for non-edit file inspection. |
| `context-mode_ctx_route` | Explain routing decision for noisy commands before execution. |
| `context-mode_ctx_fetch_run` | List/fetch redacted sidecar output created by previous runs. |
| `context-mode_ctx_gain` | Show current-session context savings from sandbox/index/cache/sidecars. |
| `context-mode_ctx_discover` | Show missed savings, bypass categories, and noisy tool patterns. |
| `context-mode_ctx_diff` | Summarize Git changes with inventory, semantic groups, and risk reason codes. |
| `context-mode_ctx_execute` / `context-mode_ctx_batch_execute` | Sandbox command/data processing; only selected stdout enters context. |
| `context-mode_ctx_search` / `context-mode_ctx_index` / `context-mode_ctx_fetch_and_index` | Knowledge-base search/index/web ingestion. |

## Experimental tools

`context-mode_ctx_guard`, `context-mode_ctx_eval`, `context-mode_ctx_trace`, and `context-mode_ctx_cache` are hidden unless `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`. Do not assume they exist during normal agent work. Prefer stable tools above.

## Parallel I/O batches

For multi-URL fetches or multi-API calls, **always** include `concurrency: N` (1-8):

- `context-mode_ctx_batch_execute(commands: [3+ network commands], concurrency: 5)` — gh, curl, dig, docker inspect, multi-region cloud queries
- `context-mode_ctx_fetch_and_index(requests: [{url, source}, ...], concurrency: 5)` — multi-URL batch fetch

**Use concurrency 4-8** for I/O-bound work (network calls, API queries). **Keep concurrency 1** for CPU-bound (npm test, build, lint) or commands sharing state (ports, lock files, same-repo writes).

GitHub API rate-limit: cap at 4 for `gh` calls.

## Output

Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `context-mode_ctx_search(source: "label")`.

## Session Continuity

Skills, roles, and decisions persist for the entire session. Do not abandon them as the conversation grows.

## Memory

Session history is persistent and searchable. On resume, search BEFORE asking the user:

| Need | Command |
|------|---------|
| What did we decide? | `context-mode_ctx_search(queries: ["decision"], source: "decision", sort: "timeline")` |
| What constraints exist? | `context-mode_ctx_search(queries: ["constraint"], source: "constraint")` |

DO NOT ask "what were we working on?" — SEARCH FIRST.
If search returns 0 results, proceed as a fresh session.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call `context-mode_ctx_stats` MCP tool, display full output verbatim. Use session scope by default. |
| `ctx gain` | Call `context-mode_ctx_gain`, display current-session savings summary. |
| `ctx discover` | Call `context-mode_ctx_discover`, display bypass/noisy-tool findings. |
| `ctx doctor` | Call `context-mode_ctx_doctor` MCP tool, run returned shell command, display as checklist. |
| `ctx upgrade` | Call `context-mode_ctx_upgrade` MCP tool, run returned shell command, display as checklist. |
| `ctx purge` | Call `context-mode_ctx_purge` MCP tool with confirm: true and explicit scope/session. Warns before wiping knowledge base. |
