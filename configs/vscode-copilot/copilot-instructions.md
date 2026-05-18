# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT attempt

### curl / wget — BLOCKED
Terminal `curl`/`wget` intercepted and blocked. Do NOT retry.
Use: `ctx_fetch_and_index(url, source)` or `ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — BLOCKED
`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, `http.request(` — intercepted. Do NOT retry.
Use: `ctx_execute(language, code)` — only stdout enters context

### WebFetch / fetch — BLOCKED
Use: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)`

## REDIRECTED — use sandbox

### Terminal / run_in_terminal (>20 lines output)
Terminal ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `ctx_batch_execute(commands, queries)` or `ctx_execute(language: "shell", code: "...")`

### read_file (for analysis)
Reading to **edit** -> read_file correct for exact edit context. Reading to **analyze/explore/summarize** -> `ctx_read(path, mode: "map" | "outline" | "symbols")`, then `ctx_read(path, mode: "slice", start, end)` for needed ranges. Use `mode: "full"` only with a reason. If `ctx_read` is unavailable, fall back to `ctx_execute_file(path, language, code)`.

### grep / search (large results)
Use `ctx_execute(language: "shell", code: "grep ...")` in sandbox.

## Tool selection

0. **MEMORY**: `ctx_search(sort: "timeline")` - after resume, check prior context before asking user.
1. **FILE MAPS**: `ctx_read(path, mode)` - first choice for file exploration, repeated reads, symbol maps, outlines, and bounded slices.
2. **ROUTING**: `ctx_route(command, explain: true)` - classify noisy commands before running them; use for `git diff`, tests, broad `rg`, logs, and long shell output.
3. **GATHER**: `ctx_batch_execute(commands, queries)` - runs commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
4. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` - all questions as array, ONE call (default relevance mode).
5. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` - sandbox, only stdout enters context.
6. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` - raw HTML never enters context.
7. **SIDECARS**: `ctx_fetch_run(list: true | latest: true | runId, raw: true)` - retrieve saved raw artifacts. Do not rerun only to see full output.
8. **MEASURE**: `ctx_gain()` for current-session savings; `ctx_discover()` for bypass/noisy-tool audit.
9. **INDEX**: `ctx_index(content, source)` - store in FTS5 for later search.

## Stable MCP tools

| Tool | Use |
|------|-----|
| `ctx_read` | File map/outline/symbols/slice/full. Default for non-edit file inspection. |
| `ctx_route` | Explain routing decision for noisy commands before execution. |
| `ctx_fetch_run` | List/fetch redacted sidecar output created by previous runs. |
| `ctx_gain` | Show current-session context savings from sandbox/index/cache/sidecars. |
| `ctx_discover` | Show missed savings, bypass categories, and noisy tool patterns. |
| `ctx_execute` / `ctx_batch_execute` | Sandbox command/data processing; only selected stdout enters context. |
| `ctx_search` / `ctx_index` / `ctx_fetch_and_index` | Knowledge-base search/index/web ingestion. |

## Experimental tools

`ctx_guard`, `ctx_eval`, `ctx_trace`, `ctx_diff`, and `ctx_cache` are hidden unless `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`. Do not assume they exist during normal agent work. Prefer stable tools above.

### Parallel I/O batches
Pass `concurrency: 4-8` to `ctx_batch_execute` and `ctx_fetch_and_index` for network/API batches. Keep `concurrency: 1` for CPU-bound work (test, build, lint). GitHub gh: cap at 4.

## Output

Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `ctx_search(source: "label")`.

## Session Continuity

Skills, roles, and decisions persist for the entire session. Do not abandon them as the conversation grows.

## Memory

Session history is persistent and searchable. On resume, search BEFORE asking the user:

| Need | Command |
|------|---------|
| What were we working on? | `ctx_search(queries: ["summary"], source: "compaction", sort: "timeline")` |
| What did we decide? | `ctx_search(queries: ["decision"], source: "decision", sort: "timeline")` |
| What NOT to repeat? | `ctx_search(queries: ["rejected"], source: "rejected-approach")` |
| What constraints exist? | `ctx_search(queries: ["constraint"], source: "constraint")` |

Note: user-prompt history not available.

DO NOT ask "what were we working on?" — SEARCH FIRST.
If search returns 0 results, proceed as a fresh session.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call `ctx_stats` MCP tool, display full output verbatim. Use session scope by default. |
| `ctx gain` | Call `ctx_gain`, display current-session savings summary. |
| `ctx discover` | Call `ctx_discover`, display bypass/noisy-tool findings. |
| `ctx doctor` | Call `ctx_doctor` MCP tool, run returned shell command, display as checklist. |
| `ctx upgrade` | Call `ctx_upgrade` MCP tool, run returned shell command, display as checklist. |
| `ctx purge` | Call `ctx_purge` MCP tool with confirm: true and explicit scope/session. Warns before wiping knowledge base. |