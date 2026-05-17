import { describe, expect, test } from "vitest";
import {
  fetchHostKey,
  getFetchPerHostConcurrency,
  runFetchPoolByHost,
  type FetchPoolJob,
} from "../../src/fetch-rate-limit.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("fetch rate limiting", () => {
  test("normalizes hosts for per-origin throttling", () => {
    expect(fetchHostKey("https://Example.COM/docs")).toBe("https://example.com");
    expect(fetchHostKey("https://example.com:8443/docs")).toBe("https://example.com:8443");
    expect(fetchHostKey("not a url")).toBe("invalid-url");
  });

  test("parses per-host concurrency from env with a conservative default", () => {
    expect(getFetchPerHostConcurrency({})).toBe(2);
    expect(getFetchPerHostConcurrency({ CONTEXT_MODE_FETCH_PER_HOST_MAX: "4" })).toBe(4);
    expect(getFetchPerHostConcurrency({ CONTEXT_MODE_FETCH_PER_HOST_MAX: "99" })).toBe(8);
    expect(getFetchPerHostConcurrency({ CONTEXT_MODE_FETCH_PER_HOST_MAX: "0" })).toBe(2);
  });

  test("keeps same-host fetches under the per-host cap", async () => {
    let active = 0;
    let maxActive = 0;
    const jobs: FetchPoolJob<number>[] = Array.from({ length: 6 }, (_, idx) => ({
      url: `https://example.com/page-${idx}`,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active--;
        return idx;
      },
    }));

    const result = await runFetchPoolByHost(jobs, {
      concurrency: 6,
      perHostConcurrency: 2,
    });

    expect(result.settled.every((r) => r.status === "fulfilled")).toBe(true);
    expect(result.effectiveConcurrency).toBe(6);
    expect(result.effectivePerHostConcurrency).toBe(2);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test("allows different hosts to use available global concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const jobs: FetchPoolJob<number>[] = Array.from({ length: 6 }, (_, idx) => ({
      url: `https://${idx % 3}.example.com/page`,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active--;
        return idx;
      },
    }));

    await runFetchPoolByHost(jobs, {
      concurrency: 6,
      perHostConcurrency: 2,
    });

    expect(maxActive).toBeGreaterThan(2);
  });

  test("captures synchronous job throws as per-index rejections", async () => {
    const result = await runFetchPoolByHost([
      {
        url: "https://example.com/a",
        run: async () => "ok",
      },
      {
        url: "https://example.com/b",
        run: () => {
          throw new Error("sync boom");
        },
      },
    ], {
      concurrency: 2,
      perHostConcurrency: 2,
    });

    expect(result.settled[0].status).toBe("fulfilled");
    expect(result.settled[1].status).toBe("rejected");
  });
});
