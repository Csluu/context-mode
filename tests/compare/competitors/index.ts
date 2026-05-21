import { rawAdapter } from "./raw.js";
import { naiveTruncateAdapter } from "./naive-truncate.js";
import { forkAdapter, forkIntentAdapter, shutdownForkClient } from "./fork.js";
import { upstreamAdapter, shutdownUpstreamClient } from "./upstream.js";
import { leanCtxAdapter } from "./lean-ctx.js";
import { contextCompressAdapter, contextCompressAggressiveAdapter } from "./context-compress.js";
import { squeezAdapter } from "./squeez.js";
import { sqzAdapter } from "./sqz.js";
import { chopAdapter } from "./chop.js";
import type { CompetitorAdapter, CompetitorId } from "./lib.js";

// Notes on omissions:
//   - lean-ctx-aggressive: `--aggressive` is not a documented flag for lean-ctx
//     3.6.11. Removed pending real mode-toggle support.
//   - sqz: cargo build fails on Windows MSVC; npm install-script 404s on the
//     release zip. Kept in registry so non-Windows users can still bench it.
export const ALL_ADAPTERS: readonly CompetitorAdapter[] = [
  rawAdapter,
  naiveTruncateAdapter,
  forkAdapter,
  forkIntentAdapter,
  upstreamAdapter,
  leanCtxAdapter,
  contextCompressAdapter,
  contextCompressAggressiveAdapter,
  squeezAdapter,
  sqzAdapter,
  chopAdapter,
];

export function findAdapter(id: CompetitorId): CompetitorAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}

export async function shutdownAllMcpClients(): Promise<void> {
  await shutdownForkClient();
  await shutdownUpstreamClient();
}

export { shutdownForkClient, shutdownUpstreamClient };
