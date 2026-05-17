import { cpus } from "node:os";

export interface FetchPoolJob<T> {
  url: string;
  run(): Promise<T>;
}

export interface FetchPoolOptions {
  concurrency: number;
  perHostConcurrency: number;
  capByCpuCount?: boolean;
  onSettled?: (idx: number, result: PromiseSettledResult<unknown>) => void;
}

export interface FetchPoolResult<T> {
  settled: PromiseSettledResult<T>[];
  effectiveConcurrency: number;
  capped: boolean;
  effectivePerHostConcurrency: number;
}

export function fetchHostKey(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
  } catch {
    return "invalid-url";
  }
}

export function getFetchPerHostConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt(env.CONTEXT_MODE_FETCH_PER_HOST_MAX ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return Math.max(1, Math.min(8, raw));
}

export async function runFetchPoolByHost<T>(
  jobs: FetchPoolJob<T>[],
  opts: FetchPoolOptions,
): Promise<FetchPoolResult<T>> {
  if (jobs.length === 0) {
    return {
      settled: [],
      effectiveConcurrency: 0,
      capped: false,
      effectivePerHostConcurrency: 0,
    };
  }

  const requested = Math.max(1, opts.concurrency);
  const cpuCap = opts.capByCpuCount ? Math.max(1, cpus().length) : requested;
  const effectiveConcurrency = Math.min(requested, cpuCap, jobs.length);
  const capped = effectiveConcurrency < requested;
  const effectivePerHostConcurrency = Math.max(
    1,
    Math.min(opts.perHostConcurrency, effectiveConcurrency),
  );

  const settled: PromiseSettledResult<T>[] = new Array(jobs.length);
  const pending = jobs.map((_, idx) => idx);
  const activeByHost = new Map<string, number>();
  let active = 0;
  let done = 0;

  return await new Promise<FetchPoolResult<T>>((resolve) => {
    const finishIfDone = () => {
      if (done === jobs.length) {
        resolve({ settled, effectiveConcurrency, capped, effectivePerHostConcurrency });
        return true;
      }
      return false;
    };

    const trySchedule = () => {
      if (finishIfDone()) return;

      while (active < effectiveConcurrency && pending.length > 0) {
        const nextPendingIdx = pending.findIndex((jobIdx) => {
          const host = fetchHostKey(jobs[jobIdx].url);
          return (activeByHost.get(host) ?? 0) < effectivePerHostConcurrency;
        });
        if (nextPendingIdx === -1) return;

        const jobIdx = pending.splice(nextPendingIdx, 1)[0];
        const host = fetchHostKey(jobs[jobIdx].url);
        active++;
        activeByHost.set(host, (activeByHost.get(host) ?? 0) + 1);

        void Promise.resolve()
          .then(() => jobs[jobIdx].run())
          .then((value) => {
            settled[jobIdx] = { status: "fulfilled", value };
          })
          .catch((reason) => {
            settled[jobIdx] = { status: "rejected", reason };
          })
          .finally(() => {
            active--;
            const hostActive = (activeByHost.get(host) ?? 1) - 1;
            if (hostActive <= 0) activeByHost.delete(host);
            else activeByHost.set(host, hostActive);
            done++;
            opts.onSettled?.(jobIdx, settled[jobIdx]);
            trySchedule();
          });
      }
    };

    trySchedule();
  });
}
