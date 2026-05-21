// Detects which competitors are installed, prints install commands for missing
// ones, then runs a CLI probe on each installed tool to confirm the wrap shape
// works. Probe: `echo PROBE-TOKEN-OK` and check output contains the marker.

import { ALL_ADAPTERS, shutdownAllMcpClients } from "./competitors/index.js";
import type { CompetitorAdapter } from "./competitors/lib.js";

const INSTALL_HINTS: Record<string, string[]> = {
  "lean-ctx": [
    "cargo install lean-ctx",
    "  (or) npm install -g lean-ctx-bin",
  ],
  "context-compress": [
    "npm install -g context-compress",
    "  (then) context-compress setup --auto    # for hooks",
  ],
  "squeez": [
    "npm install -g squeez",
    "  (then) squeez setup",
  ],
  "sqz": [
    "cargo install sqz-cli",
  ],
  "chop": [
    "npm install -g chop",
    "  (then) chop init --global",
  ],
  "fork": [
    "npm run build   # local context-mode (this repo)",
  ],
  "fork-intent": [
    "same as fork — built locally with `npm run build`",
  ],
  "upstream": [
    "npm run compare:setup   # clone + build upstream mksglu/context-mode at pinned SHA",
  ],
  "raw": [
    "no install — bash + cat baseline",
  ],
};

const PROBE_CMD = "echo PROBE-TOKEN-OK";
const PROBE_MARKER = "PROBE-TOKEN-OK";

async function probeAdapter(adapter: CompetitorAdapter): Promise<{ ok: boolean; bytes: number; ms: number; reason?: string }> {
  try {
    const res = await adapter.runCommand(PROBE_CMD, { timeoutMs: 10_000, keepOutput: true });
    if (!res.ok) return { ok: false, bytes: res.bytes, ms: res.ms, reason: res.errorReason ?? "adapter ok=false" };
    if (!res.output || !res.output.includes(PROBE_MARKER)) {
      return { ok: false, bytes: res.bytes, ms: res.ms, reason: `marker missing in output (got ${res.bytes} bytes)` };
    }
    return { ok: true, bytes: res.bytes, ms: res.ms };
  } catch (err) {
    return { ok: false, bytes: 0, ms: 0, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  console.log("Phase 1 competitor availability:");
  console.log("");
  const detections = new Map<string, { available: boolean; version?: string; reason?: string }>();
  for (const adapter of ALL_ADAPTERS) {
    const det = await adapter.detect();
    detections.set(adapter.id, det);
    const status = det.available ? "✓" : "✗";
    const versionOrReason = det.available ? (det.version ?? "") : (det.reason ?? "missing");
    console.log(`  ${status} ${adapter.id.padEnd(18)} ${versionOrReason}`);
  }

  console.log("");
  console.log("CLI probe — verify each installed tool's wrap shape works:");
  for (const adapter of ALL_ADAPTERS) {
    const det = detections.get(adapter.id)!;
    if (!det.available) continue;
    const probe = await probeAdapter(adapter);
    const status = probe.ok ? "✓" : "✗";
    const detail = probe.ok
      ? `wrap shape OK (${probe.bytes}B, ${probe.ms}ms)`
      : `WRAP SHAPE FAIL — ${probe.reason}`;
    console.log(`  ${status} ${adapter.id.padEnd(18)} ${detail}`);
  }

  console.log("");
  const missing = ALL_ADAPTERS.filter((a) => !detections.get(a.id)!.available);
  if (missing.length > 0) {
    console.log("Install hints for missing tools:");
    for (const adapter of missing) {
      const hints = INSTALL_HINTS[adapter.id] ?? [`<no hint configured for ${adapter.id}>`];
      console.log(`  ${adapter.id}:`);
      for (const h of hints) console.log(`    ${h}`);
    }
    console.log("");
  }
  console.log("After installing, run:  npm run compare:competitors:run");

  await shutdownAllMcpClients();
}

main().catch((err) => {
  console.error("install detector failed:", err);
  process.exit(1);
});
