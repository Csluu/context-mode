# context-mode

Raw tool output floods context window. Use context-mode MCP tools to keep raw data in sandbox.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## Tool Selection

1. **FILE MAPS**: `ctx_read(path, mode)` — first choice for file exploration, repeated reads, symbols, outlines, and bounded slices.
2. **ROUTING**: `ctx_route(command, explain: true)` — classify noisy commands before running them.
3. **GATHER**: `ctx_batch_execute(commands, queries)` — runs commands, auto-indexes, searches. ONE call replaces many steps.
4. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — all follow-up questions, ONE call.
5. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — sandbox, only stdout enters context.
6. **WEB**: `ctx_fetch_and_index(url)` then `ctx_search(queries)` — never dump raw HTML.
7. **SIDECARS**: `ctx_fetch_run(list: true | latest: true | runId, raw: true)` — fetch saved raw artifacts instead of rerunning commands.
8. **MEASURE**: `ctx_gain()` for current-session savings; `ctx_discover()` for bypass/noisy-tool audit.

## Rules

- DO NOT use Bash for >20 lines output — use `ctx_execute` or `ctx_batch_execute`.
- DO NOT use Read for analysis — use `ctx_read` map/outline/symbols/slice first. Read IS correct for Edit.
- DO NOT use WebFetch — use `ctx_fetch_and_index`.
- DO NOT use curl/wget in Bash — use `ctx_execute` or `ctx_fetch_and_index`.
- Bash ONLY for git, mkdir, rm, mv, navigation, short commands.

## Stable Tools

Default public tools: `ctx_read`, `ctx_route`, `ctx_fetch_run`, `ctx_gain`, `ctx_discover`, `ctx_diff`, plus the existing execute/search/fetch/stats/admin tools. Experimental tools (`ctx_guard`, `ctx_eval`, `ctx_trace`, `ctx_cache`) stay hidden unless `CTX_MODE_EXPERIMENTAL=1` or `CONTEXT_MODE_EXPERIMENTAL=1`.

## Output

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging. Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step]. Auto-expand for: security warnings, irreversible actions, user confusion.
Write artifacts to FILES — never inline. Return: file path + 1-line description.
