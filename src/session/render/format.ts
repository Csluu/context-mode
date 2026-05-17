/**
 * session/render/format — Pure formatting helpers extracted from analytics.ts.
 *
 * Phase 1 of the analytics split (see MIGRATION.md). Functions here have
 * no I/O, no DB access, no module-level state. Output is byte-identical to
 * the legacy inline copies in analytics.ts — verified via unit tests.
 *
 * Imported by `src/session/analytics.ts` and (eventually) the Insight web
 * UI's data renderer.
 */

/**
 * Format a byte count using human-readable units. Behavior matches the
 * legacy analytics renderer exactly:
 *   - non-finite / non-positive ⇒ "0 B"
 *   - <1 KB                    ⇒ rounded integer bytes
 *   - <100 of any unit         ⇒ one decimal place
 *   - >=100 of any unit        ⇒ rounded integer
 * Scale awareness comes from the unit jump between rows.
 */
export function kb(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  if (b < 1024) return `${Math.round(b)} B`;

  const KB = b / 1024;
  if (KB < 1024) {
    return KB < 100 ? `${KB.toFixed(1)} KB` : `${Math.round(KB)} KB`;
  }

  const MB = KB / 1024;
  if (MB < 1024) {
    return MB < 100 ? `${MB.toFixed(1)} MB` : `${Math.round(MB)} MB`;
  }

  const GB = MB / 1024;
  return GB < 100 ? `${GB.toFixed(1)} GB` : `${Math.round(GB)} GB`;
}

/**
 * Compact integer formatter ("1.2M" / "1.5K" / "500"). Matches the legacy
 * inline definition. Always returns a string; never throws.
 */
export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Opus 4 input price: $15 per 1M tokens. */
export const OPUS_INPUT_PRICE_PER_TOKEN = 15 / 1_000_000;

/** Convert a token count to a USD string at the Opus input rate. */
export function tokensToUsd(tokens: number): string {
  const safe = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  return `$${(safe * OPUS_INPUT_PRICE_PER_TOKEN).toFixed(2)}`;
}
