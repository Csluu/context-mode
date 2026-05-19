import { createHash } from "node:crypto";

function shortUrlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function sanitizeSourceLabel(source: string | undefined, url: string): string {
  const explicit = source?.trim();
  if (explicit) return explicit.replace(/\s+/g, " ").slice(0, 160);

  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "").slice(0, 160) || "fetched-url";
  } catch {
    return "fetched-url";
  }
}

/**
 * Cache-key / storage-label composition for ctx_fetch_and_index.
 *
 * The full URL remains part of identity through a hash, but token-bearing query
 * strings and credentials are not exposed in user-visible source labels.
 */
export function composeFetchCacheKey(source: string | undefined, url: string): string {
  return `${sanitizeSourceLabel(source, url)}#url-${shortUrlHash(url)}`;
}
