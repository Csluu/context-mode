/**
 * session/render/bars — Proportional bar chart helpers extracted from
 * analytics.ts. Pure math + string output, no I/O.
 */

/**
 * Build a proportional bar using █ chars, scaled to a fixed width.
 * Returns e.g. "████████████████████████████████████████" for full width.
 */
export function dataBar(bytes: number, maxBytes: number, width: number = 40): string {
  if (maxBytes <= 0) return "░".repeat(width);
  const filled = Math.max(1, Math.round((bytes / maxBytes) * width));
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(0, width - filled));
}

