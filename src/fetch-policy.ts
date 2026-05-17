export function parseFetchAllowlist(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getFetchAllowlistFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseFetchAllowlist(
    env.CONTEXT_MODE_FETCH_ALLOW_HOSTS || env.CTX_FETCH_ALLOW_HOSTS,
  );
}

export function isFetchHostAllowed(hostname: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;

  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  for (const entry of allowlist) {
    if (entry === host) return true;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      if (host.endsWith(suffix) && host.length > suffix.length) return true;
    }
  }
  return false;
}

export function fetchAllowlistError(rawUrl: string, allowlist: readonly string[]): string | null {
  if (allowlist.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "invalid URL";
  }

  if (isFetchHostAllowed(parsed.hostname, allowlist)) return null;
  return `URL host "${parsed.hostname}" is not in CONTEXT_MODE_FETCH_ALLOW_HOSTS`;
}
