# Analytics render extraction plan

`src/session/analytics.ts` is 2825 LOC and mixes pure compute (token
counting, byte aggregation, semver math) with presentation (markdown
rendering, ANSI bars, date formatting). The latter belongs here.

## Why split

- The Insight web UI re-implements similar formatters in TypeScript inside
  `insight/src/`. A shared render layer eliminates the drift.
- Analytics compute can be unit-tested without owning a terminal width or
  locale.
- Render helpers are pure — moving them is safe (no DB / no side effects).

## Inventory (file location → target)

| Function                  | analytics.ts line | Pure? | Target file                |
|---------------------------|-------------------|-------|----------------------------|
| `kb(b)`                   | 1622              | yes   | `render/format.ts`         |
| `formatDuration(uptime)`  | 1641              | yes   | `render/format.ts`         |
| `shortPath(abs)`          | 1747              | yes   | `render/format.ts`         |
| `formatLocalDateTime`     | 2225              | yes   | `render/format.ts`         |
| `fmtNum(n)`               | 2255              | yes   | `render/format.ts`         |
| `tokensToUsd(tokens)`     | 2269              | yes   | `render/cost.ts`           |
| `OPUS_INPUT_PRICE_PER_TOKEN` | 2266           | const | `render/cost.ts`           |
| `dataBar(bytes, max, w)`  | 2278              | yes   | `render/bars.ts`           |
| `renderHorizontalTimeline`| 2149              | yes   | `render/timeline.ts`       |
| `renderCostExample`       | 1783              | yes*  | `render/cost.ts`           |
| `renderNarrative5Section` | 1856              | yes*  | `render/narrative.ts`      |
| `collapseBlanks`          | 2102              | yes   | `render/format.ts`         |
| `renderProjectMemory`     | 2294              | yes*  | `render/memory.ts`         |
| `renderAutoMemory`        | 2398              | yes*  | `render/memory.ts`         |

`yes*` = pure modulo the data it formats; no I/O.

## Migration steps (per function)

1. Copy the function to its target file under `src/session/render/`.
2. In `analytics.ts`, replace the local definition with an import.
3. Run `npm test -- tests/analytics.test.ts` to confirm.
4. Optional: add a focused render test in `tests/render/`.

## Recommended order

1. `format.ts` cluster (kb, fmtNum, formatLocalDateTime, shortPath,
   formatDuration, collapseBlanks) — zero deps, biggest win.
2. `cost.ts` cluster (tokensToUsd, OPUS_INPUT_PRICE_PER_TOKEN,
   renderCostExample) — adds Insight UI dedup.
3. `bars.ts` (dataBar) — single dep.
4. `timeline.ts` (renderHorizontalTimeline) — uses kb + dataBar.
5. `memory.ts` (renderProjectMemory, renderAutoMemory) — biggest, do last.
6. `narrative.ts` (renderNarrative5Section) — calls into all of the above.

## Anti-goals

- Do NOT introduce a `RenderContext` carrying locale/tz/colorMode — pass
  these as explicit function arguments. Implicit context across render
  helpers is a debugging nightmare.
- Do NOT pull markdown rendering into a templating engine. The current
  string-array style (push lines, `.join("\n")`) is simple, fast, and
  matches every other Mission Control / context-mode renderer.
- Keep the Insight web UI's TS formatters in sync via test parity — both
  layers should produce identical output for the same input.
