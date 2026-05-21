import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeCtxCode } from "../../src/tools/code.js";
import type { ToolContext } from "../../src/tools/types.js";

interface Candidate {
  readonly file: string;
  readonly symbol: string;
  readonly kind?: string;
}

interface Target {
  readonly name: string;
  readonly projectDir: string;
  readonly candidates: Candidate[];
}

interface ProfileRow {
  readonly target: string;
  readonly file: string;
  readonly symbol: string;
  readonly action: string;
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly ok: boolean;
}

interface TargetProfile {
  readonly target: string;
  readonly projectDir: string;
  readonly ok: boolean;
  readonly skipped?: true;
  readonly reason?: string;
  readonly rows: ProfileRow[];
  readonly outputBytes: number;
  readonly approxTokens: number;
  readonly elapsedMs: number;
  readonly rawUniqueFileBytes: number;
  readonly savingsVsRawUniquePct: number | null;
  readonly rawActionEquivalentBytes: number;
  readonly savingsVsRawActionsPct: number | null;
  readonly dbBytes: number;
  readonly checks: Array<{ name: string; pass: boolean; value: number | string }>;
}

interface CostPayload {
  readonly generatedAt: string;
  readonly decision: "pass" | "not-ready";
  readonly note: string;
  readonly process: {
    readonly pid: number;
    readonly rssStartBytes: number;
    readonly rssEndBytes: number;
    readonly rssDeltaBytes: number;
    readonly knownExtraLongRunningProcesses: 0;
  };
  readonly targets: TargetProfile[];
}

const contextModeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(contextModeRoot, "build", "compare");
const rustFixtureRoot = join(contextModeRoot, "tests", "compare", "fixtures", "rust-navigation");
mkdirSync(outDir, { recursive: true });

const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");
const sessionsDir = join(outDir, "code-cost-profile-sessions", stamp);
mkdirSync(sessionsDir, { recursive: true });

const args = process.argv.slice(2);
const check = args.includes("--check");
const allowSkips = args.includes("--allow-skips");
const includeRealRepos = args.includes("--real-repos");

const targets: Target[] = [
  {
    name: "context-mode",
    projectDir: contextModeRoot,
    candidates: [
      { file: "src/read/ctx-read.ts", symbol: "ctxRead", kind: "function" },
      { file: "src/tools/code.ts", symbol: "makeCtxCode", kind: "function" },
    ],
  },
  {
    name: "rust-navigation",
    projectDir: rustFixtureRoot,
    candidates: [
      { file: "src/worker.rs", symbol: "build_worker", kind: "function" },
      { file: "src/worker.rs", symbol: "Worker", kind: "struct" },
      { file: "src/worker.rs", symbol: "Worker.new", kind: "method" },
    ],
  },
];

if (includeRealRepos) {
  targets.push(
    {
      name: "widget-launcher",
      projectDir: "C:\\Users\\chris\\Documents\\GitHub\\widget-launcher",
      candidates: [
        { file: "src/renderer/App.tsx", symbol: "App", kind: "function" },
        { file: "src/renderer/components/ErrorBoundary.tsx", symbol: "ErrorBoundary", kind: "class" },
        { file: "src/renderer/components/ScriptsEditor.tsx", symbol: "ScriptsEditor", kind: "function" },
        { file: "src/renderer/hooks/useVisibilityTimer.ts", symbol: "useVisibilityTimer", kind: "function" },
        { file: "src-tauri/src/lib.rs", symbol: "create_widget_window", kind: "function" },
        { file: "src-tauri/src/config.rs", symbol: "load_config", kind: "function" },
        { file: "src-tauri/src/scripts.rs", symbol: "run_script", kind: "function" },
        { file: "src-tauri/src/widgets.rs", symbol: "WidgetWindowConfig", kind: "struct" },
        { file: "src-tauri/src/window_mgr.rs", symbol: "create_widget_window", kind: "function" },
      ],
    },
    {
      name: "mission-control",
      projectDir: "C:\\Users\\chris\\Documents\\GitHub\\mission-control-master",
      candidates: [
        { file: "frontend/src/App.tsx", symbol: "PageSkeleton", kind: "function" },
        { file: "features/activity/service.ts", symbol: "buildActivity", kind: "function" },
        { file: "features/agents/service.ts", symbol: "listAgents", kind: "function" },
        { file: "features/analytics/aggregateSessions.ts", symbol: "aggregateSessions", kind: "function" },
      ],
    },
  );
}

const rssStartBytes = process.memoryUsage().rss;
const profiles: TargetProfile[] = [];
for (const target of targets) {
  profiles.push(await profileTarget(target));
}
const rssEndBytes = process.memoryUsage().rss;
const decision: "pass" | "not-ready" = profiles.every((profile) => profile.ok || (allowSkips && profile.skipped === true)) ? "pass" : "not-ready";
const payload: CostPayload = {
  generatedAt,
  decision,
  note: "Measures static ctx_code payload bytes, elapsed time, clean DB storage, and current-process RSS delta. knownExtraLongRunningProcesses is a design assertion for ctx_code, not live child-process instrumentation; the script does not measure live Serena RSS because Serena is not launched.",
  process: {
    pid: process.pid,
    rssStartBytes,
    rssEndBytes,
    rssDeltaBytes: rssEndBytes - rssStartBytes,
    knownExtraLongRunningProcesses: 0,
  },
  targets: profiles,
};

const jsonPath = join(outDir, `code-cost-profile-${stamp}.json`);
const mdPath = join(outDir, `code-cost-profile-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
writeFileSync(mdPath, renderMarkdown(payload));

console.log(JSON.stringify({
  decision,
  jsonPath,
  mdPath,
  process: payload.process,
  targets: profiles.map((profile) => ({
    target: profile.target,
    ok: profile.ok,
    skipped: profile.skipped === true,
    outputBytes: profile.outputBytes,
    approxTokens: profile.approxTokens,
    elapsedMs: profile.elapsedMs,
    dbBytes: profile.dbBytes,
    rawUniqueFileBytes: profile.rawUniqueFileBytes,
    savingsVsRawUniquePct: profile.savingsVsRawUniquePct,
    rawActionEquivalentBytes: profile.rawActionEquivalentBytes,
    savingsVsRawActionsPct: profile.savingsVsRawActionsPct,
    checks: profile.checks,
  })),
}, null, 2));

if (check && decision !== "pass") process.exit(1);

async function profileTarget(target: Target): Promise<TargetProfile> {
  if (!existsSync(target.projectDir)) return skippedProfile(target, "project path missing");
  const candidates = target.candidates.filter((candidate) => existsSync(join(target.projectDir, candidate.file)));
  if (candidates.length === 0) return skippedProfile(target, "no pinned candidate files found");

  const beforeDbBytes = dirBytes(sessionsDir);
  const tool = makeCtxCode({ getProjectDir: () => target.projectDir });
  const ctx = context();
  const rows: ProfileRow[] = [];
  for (const candidate of candidates) {
    rows.push(
      await runCase(target, candidate, tool, ctx, "file_outline", {
        action: "file_outline",
        file: candidate.file,
        compact: true,
        budgetBytes: 8192,
      }),
      await runCase(target, candidate, tool, ctx, "find_symbol", {
        action: "find_symbol",
        query: candidate.symbol,
        file: candidate.file,
        kind: candidate.kind,
        compact: true,
        limit: 1,
        budgetBytes: 4096,
      }),
      await runCase(target, candidate, tool, ctx, "read_symbol", {
        action: "read_symbol",
        query: candidate.symbol,
        file: candidate.file,
        kind: candidate.kind,
        budgetBytes: 8192,
      }),
      await runCase(target, candidate, tool, ctx, "refs_light", {
        action: "refs_light",
        symbol: candidate.symbol,
        file: candidate.file,
        limit: 20,
        budgetBytes: 8192,
      }),
      await runCase(target, candidate, tool, ctx, "related_files", {
        action: "related_files",
        file: candidate.file,
        limit: 12,
        budgetBytes: 8192,
      }),
      await runCase(target, candidate, tool, ctx, "likely_tests", {
        action: "likely_tests",
        file: candidate.file,
        limit: 12,
        budgetBytes: 4096,
      }),
      await runCase(target, candidate, tool, ctx, "pack", {
        action: "pack",
        query: candidate.symbol,
        file: candidate.file,
        kind: candidate.kind,
        limit: 20,
        budgetBytes: 10 * 1024,
      }),
    );
  }
  const afterDbBytes = dirBytes(sessionsDir);
  const uniqueFiles = new Set(candidates.map((candidate) => candidate.file));
  const rawBytesByFile = new Map<string, number>();
  let rawUniqueFileBytes = 0;
  for (const file of uniqueFiles) {
    try {
      const bytes = statSync(join(target.projectDir, file)).size;
      rawBytesByFile.set(file, bytes);
      rawUniqueFileBytes += bytes;
    } catch { /* skip */ }
  }
  const outputBytes = rows.reduce((total, row) => total + row.bytes, 0);
  const elapsedMs = rows.reduce((total, row) => total + row.elapsedMs, 0);
  const rawActionEquivalentBytes = rows.reduce((total, row) => total + (rawBytesByFile.get(row.file) ?? 0), 0);
  const savingsVsRawUniquePct = rawUniqueFileBytes > 0
    ? round1((1 - outputBytes / rawUniqueFileBytes) * 100)
    : null;
  const savingsVsRawActionsPct = rawActionEquivalentBytes > 0
    ? round1((1 - outputBytes / rawActionEquivalentBytes) * 100)
    : null;
  const dbBytes = afterDbBytes - beforeDbBytes;
  const fastRows = rows.filter((row) => row.action !== "pack");
  const packRows = rows.filter((row) => row.action === "pack");
  const avgFastActionMs = fastRows.length > 0
    ? Math.round(fastRows.reduce((total, row) => total + row.elapsedMs, 0) / fastRows.length)
    : 0;
  const maxPackMs = packRows.reduce((max, row) => Math.max(max, row.elapsedMs), 0);
  const checks = [
    { name: "all-actions-ok", pass: rows.every((row) => row.ok), value: rows.filter((row) => !row.ok).length },
    { name: "payload-under-raw-action-equivalent", pass: rawActionEquivalentBytes > 0 && outputBytes <= rawActionEquivalentBytes, value: `${outputBytes}/${rawActionEquivalentBytes}` },
    { name: "db-under-2mb", pass: dbBytes <= 2 * 1024 * 1024, value: dbBytes },
    { name: "avg-fast-action-under-250ms", pass: fastRows.length > 0 && avgFastActionMs <= 250, value: avgFastActionMs },
    { name: "pack-under-1500ms", pass: packRows.length > 0 && maxPackMs <= 1500, value: maxPackMs },
  ];
  return {
    target: target.name,
    projectDir: target.projectDir,
    ok: checks.every((item) => item.pass),
    rows,
    outputBytes,
    approxTokens: Math.ceil(outputBytes / 4),
    elapsedMs,
    rawUniqueFileBytes,
    savingsVsRawUniquePct,
    rawActionEquivalentBytes,
    savingsVsRawActionsPct,
    dbBytes,
    checks,
  };
}

function skippedProfile(target: Target, reason: string): TargetProfile {
  return {
    target: target.name,
    projectDir: target.projectDir,
    ok: false,
    skipped: true,
    reason,
    rows: [],
    outputBytes: 0,
    approxTokens: 0,
    elapsedMs: 0,
    rawUniqueFileBytes: 0,
    savingsVsRawUniquePct: null,
    rawActionEquivalentBytes: 0,
    savingsVsRawActionsPct: null,
    dbBytes: 0,
    checks: [],
  };
}

function context(): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: contextModeRoot,
    getSessionDir: () => sessionsDir,
    trackResponse: (_tool, response) => response,
  };
}

async function runCase(
  target: Target,
  candidate: Candidate,
  tool: ReturnType<typeof makeCtxCode>,
  ctx: ToolContext,
  action: string,
  input: Parameters<typeof tool.handler>[0],
): Promise<ProfileRow> {
  const started = Date.now();
  const result = await tool.handler(input, ctx);
  const text = result.content[0]?.text ?? "";
  return {
    target: target.name,
    file: candidate.file,
    symbol: candidate.symbol,
    action,
    bytes: Buffer.byteLength(text),
    elapsedMs: Date.now() - started,
    ok: !result.isError,
  };
}

function dirBytes(root: string): number {
  let total = 0;
  function walk(dir: string): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try { total += statSync(full).size; } catch { /* skip */ }
      }
    }
  }
  walk(root);
  return total;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function renderMarkdown(payload: CostPayload): string {
  const lines = [
    "# Code Cost Profile",
    "",
    `Generated: ${payload.generatedAt}`,
    `Decision: ${payload.decision}`,
    "",
    "## Process",
    "",
    `- RSS start: ${payload.process.rssStartBytes} B`,
    `- RSS end: ${payload.process.rssEndBytes} B`,
    `- RSS delta: ${payload.process.rssDeltaBytes} B`,
    `- Known extra long-running processes: ${payload.process.knownExtraLongRunningProcesses}`,
    "",
  ];
  for (const target of payload.targets) {
    lines.push(`## ${target.target}`, "", `Project: ${target.projectDir}`);
    if (target.skipped) {
      lines.push(`Skipped: ${target.reason}`, "");
      continue;
    }
    lines.push(
      `Output: ${target.outputBytes} B (~${target.approxTokens} tokens)`,
      `Elapsed: ${target.elapsedMs} ms`,
      `DB bytes: ${target.dbBytes}`,
      `Raw unique file bytes: ${target.rawUniqueFileBytes}`,
      `Savings vs raw unique files: ${target.savingsVsRawUniquePct}%`,
      `Raw action-equivalent bytes: ${target.rawActionEquivalentBytes}`,
      `Savings vs raw action-equivalent reads: ${target.savingsVsRawActionsPct}%`,
      "",
      "| Check | Value | Result |",
      "|---|---:|---|",
    );
    for (const check of target.checks) {
      lines.push(`| ${check.name} | ${check.value} | ${check.pass ? "pass" : "not-ready"} |`);
    }
    lines.push("", "| File | Symbol | Action | Bytes | Time | Result |", "|---|---|---|---:|---:|---|");
    for (const row of target.rows) {
      lines.push(`| ${relative(target.projectDir, join(target.projectDir, row.file)).replace(/\\/g, "/")} | ${row.symbol} | ${row.action} | ${row.bytes} | ${row.elapsedMs} ms | ${row.ok ? "ok" : "fail"} |`);
    }
    lines.push("");
  }
  lines.push(payload.note, "");
  return lines.join("\n");
}
