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

import { homedir } from "node:os";
import { sep } from "node:path";


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

// ─────────────────────────────────────────────────────────
// Extracted from session/analytics.ts (phase 2 of MIGRATION.md)
// ─────────────────────────────────────────────────────────

/** Format session uptime as human-readable duration. */
export function formatDuration(uptimeMin: string): string {
  const min = parseFloat(uptimeMin);
  if (isNaN(min) || min < 1) return "< 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format an absolute path as a human-friendly display string by
 * collapsing `$HOME` → `~`. Returns the input unchanged when no home
 * prefix matches (e.g. for paths outside $HOME on a CI box).
 */
export function shortPath(abs: string): string {
  const home = homedir();
  if (!home) return abs;
  if (abs === home) return "~";
  // Use platform separator so `C:\Users\Mert\projects\x` collapses to `~\projects\x`
  // on Windows; previous `home + "/"` check was vacuously false on Windows and
  // left full absolute paths in the Section 1 narrative opener (round-5 finding).
  if (abs.startsWith(home + sep)) return "~" + abs.slice(home.length);
  return abs;
}

/**
 * Render a UTC ms timestamp as a human-readable local datetime string in
 * the canonical Mert-approved format:
 *
 *   "28 Apr 2026 at 12:16 (Europe/Istanbul)"
 *
 * Used by the 5-section narrative renderer (formatReport) so users see
 * exactly when their conversation started + when /compact rescues fired
 * in their wall-clock timezone — never UTC, never ambiguous.
 *
 * - 24-hour clock with zero-padded minutes ("20:54", not "8:54 PM").
 * - Day is NOT zero-padded ("9 May", not "09 May") to match the target.
 * - IANA timezone is appended verbatim in parentheses regardless of
 *   locale so users never misread Istanbul-time as UTC.
 * - Returns "" for ms === 0 or NaN so callers can guard the rendered
 *   line ("started …") without an extra timestamp-validity check.
 */
export function formatLocalDateTime(ms: number, locale: string, tz: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  // Intl.DateTimeFormat's "day"/"month"/"year" parts give us the locale's
  // ordering (en-* → "DD MMM YYYY"), and the explicit numeric hour/minute
  // forces 24-hour with leading zero on minute when in en-* with hour12=false.
  const dt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    dt.find((p) => p.type === type)?.value ?? "";
  const day   = get("day");
  const month = get("month");
  const year  = get("year");
  let hour    = get("hour");
  const min   = get("minute");
  // Some locales / some Node versions emit "24" for midnight under hour12=false.
  // Coerce back to "00" so the displayed time is always wall-clock-correct.
  if (hour === "24") hour = "00";
  return `${day} ${month} ${year} at ${hour}:${min} (${tz})`;
}

/** Drop runs of >2 consecutive blank strings so the renderer never emits visual gaps. */
export function collapseBlanks(lines: string[]): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const ln of lines) {
    if (ln === "") {
      blankRun++;
      if (blankRun <= 2) out.push(ln);
    } else {
      blankRun = 0;
      out.push(ln);
    }
  }
  // Trim trailing blanks.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}
