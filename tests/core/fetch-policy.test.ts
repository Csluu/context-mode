import { describe, expect, test } from "vitest";
import {
  fetchAllowlistError,
  isFetchHostAllowed,
  parseFetchAllowlist,
} from "../../src/fetch-policy.js";

describe("fetch allow-list policy", () => {
  test("empty allow-list preserves existing allow behavior", () => {
    expect(isFetchHostAllowed("example.com", [])).toBe(true);
    expect(fetchAllowlistError("https://example.com/docs", [])).toBeNull();
  });

  test("exact host entries are case-insensitive", () => {
    const allowlist = parseFetchAllowlist("Example.com, docs.example.com");

    expect(isFetchHostAllowed("example.com", allowlist)).toBe(true);
    expect(isFetchHostAllowed("DOCS.EXAMPLE.COM", allowlist)).toBe(true);
    expect(isFetchHostAllowed("evil.example.com", allowlist)).toBe(false);
  });

  test("wildcard host entries match subdomains only", () => {
    const allowlist = parseFetchAllowlist("*.example.com");

    expect(isFetchHostAllowed("docs.example.com", allowlist)).toBe(true);
    expect(isFetchHostAllowed("deep.docs.example.com", allowlist)).toBe(true);
    expect(isFetchHostAllowed("example.com", allowlist)).toBe(false);
    expect(isFetchHostAllowed("badexample.com", allowlist)).toBe(false);
  });

  test("returns a blocking error when URL host is outside the allow-list", () => {
    const allowlist = parseFetchAllowlist("docs.example.com");

    expect(fetchAllowlistError("https://docs.example.com/a", allowlist)).toBeNull();
    expect(fetchAllowlistError("https://evil.example.com/a", allowlist)).toContain(
      "not in CONTEXT_MODE_FETCH_ALLOW_HOSTS",
    );
  });
});
