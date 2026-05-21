import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeCtxCode } from "../../src/tools/code.js";
import type { ToolContext } from "../../src/tools/types.js";

interface RepoTarget {
  readonly name: string;
  readonly projectDir: string;
  readonly archived?: boolean;
}

interface Candidate {
  readonly file: string;
  readonly symbol: string;
  readonly kind?: string;
}

interface BenchmarkRow {
  readonly label: string;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly bytes: number;
  readonly preview: string;
  readonly text: string;
}

interface ArchivedComparison {
  readonly scenario: string;
  readonly serenaBytes: number;
  readonly contextModeBytes: number;
  readonly pass: boolean;
}

interface SmokeCheck {
  readonly scenario: string;
  readonly bytes: number;
  readonly pass: boolean;
}

interface SerenaCommandProbe {
  readonly command: string;
  readonly args: readonly string[];
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  readonly elapsedMs: number;
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
  readonly error?: string;
}

interface SerenaDirectRow {
  readonly scenario: string;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly bytes: number;
  readonly preview: string;
  readonly error?: string;
}

interface SerenaDirectRowsProbe {
  readonly command: string;
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  readonly elapsedMs: number;
  readonly rows: readonly SerenaDirectRow[];
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
  readonly error?: string;
}

interface SerenaAvailability {
  readonly comparisonSource: "archived-only" | "archived-plus-live-probe" | "archived-plus-live-probe-and-direct-rows";
  readonly archivedCapturedAt: string;
  readonly archivedRows: number;
  readonly liveRequired: boolean;
  readonly liveProbeAttempted: boolean;
  readonly liveUsable: boolean;
  readonly directRowsRequested: boolean;
  readonly directRowsRequired: boolean;
  readonly directRowsAttempted: boolean;
  readonly directRowsUsable: boolean;
  readonly directRows: readonly SerenaDirectRow[];
  readonly mcpTransport: {
    readonly status: "not-reported" | "ok" | "failed";
    readonly error?: string;
  };
  readonly executable?: string;
  readonly directRunner?: string;
  readonly whereProbe?: SerenaCommandProbe;
  readonly versionProbe?: SerenaCommandProbe;
  readonly directRowsProbe?: SerenaDirectRowsProbe;
  readonly blocker?: string;
}

interface ArchivedResult {
  readonly target: string;
  readonly projectDir: string;
  readonly kind: "archived-serena";
  readonly ok: boolean;
  readonly rows: BenchmarkRow[];
  readonly comparisons: ArchivedComparison[];
}

interface RealRepoResult {
  readonly target: string;
  readonly projectDir: string;
  readonly kind: "real-repo";
  readonly ok: boolean;
  readonly candidate: Candidate;
  readonly candidates: Candidate[];
  readonly rows: BenchmarkRow[];
  readonly checks: SmokeCheck[];
}

interface SkippedResult {
  readonly target: string;
  readonly projectDir: string;
  readonly kind: "real-repo";
  readonly ok: false;
  readonly skipped: true;
  readonly reason: string;
  readonly rows: BenchmarkRow[];
  readonly checks: SmokeCheck[];
}

type BenchmarkResult = ArchivedResult | RealRepoResult | SkippedResult;

interface BenchmarkPayload {
  readonly generatedAt: string;
  readonly decision: "pass" | "not-ready";
  readonly note: string;
  readonly serena: SerenaAvailability;
  readonly archivedSerena: typeof archivedSerena;
  readonly results: BenchmarkResult[];
}

const contextModeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(contextModeRoot, "build", "compare");
const sessionsDir = join(outDir, "serena-removal-sessions");
const rustFixtureRoot = join(contextModeRoot, "tests", "compare", "fixtures", "rust-navigation");
mkdirSync(sessionsDir, { recursive: true });

const archivedSerena = [
  { scenario: "get_symbols_overview src/read/ctx-read.ts", bytes: 779 },
  { scenario: "find_symbol ctxRead location", bytes: 142 },
  { scenario: "find_symbol ctxRead body", bytes: 4947 },
] as const;

const pinnedRealCandidates: Record<string, Candidate[]> = {
  "widget-launcher": [
    { file: "src/renderer/App.tsx", symbol: "App", kind: "function" },
    { file: "src/renderer/components/ErrorBoundary.tsx", symbol: "ErrorBoundary", kind: "class" },
    { file: "src/renderer/components/ScriptsEditor.tsx", symbol: "ScriptsEditor", kind: "function" },
    { file: "src/renderer/hooks/useVisibilityTimer.ts", symbol: "useVisibilityTimer", kind: "function" },
    { file: "src/renderer/desktopApi.d.ts", symbol: "DesktopAPI", kind: "interface" },
    { file: "src-tauri/src/lib.rs", symbol: "create_widget_window", kind: "function" },
    { file: "src-tauri/src/config.rs", symbol: "load_config", kind: "function" },
    { file: "src-tauri/src/scripts.rs", symbol: "run_script", kind: "function" },
    { file: "src-tauri/src/widgets.rs", symbol: "WidgetWindowConfig", kind: "struct" },
    { file: "src-tauri/src/window_mgr.rs", symbol: "create_widget_window", kind: "function" },
  ],
  "mission-control": [
    { file: "frontend/src/App.tsx", symbol: "PageSkeleton", kind: "function" },
    { file: "features/activity/service.ts", symbol: "buildActivity", kind: "function" },
    { file: "features/agents/service.ts", symbol: "listAgents", kind: "function" },
    { file: "features/analytics/aggregateSessions.ts", symbol: "aggregateSessions", kind: "function" },
  ],
  "rust-navigation": [
    { file: "src/worker.rs", symbol: "build_worker", kind: "function" },
    { file: "src/worker.rs", symbol: "Worker", kind: "struct" },
    { file: "src/worker.rs", symbol: "Worker.new", kind: "method" },
  ],
};

const args = process.argv.slice(2);
const check = args.includes("--check");
const allowSkips = args.includes("--allow-skips");
const includeRealRepos = args.includes("--real-repos");
const directSerenaRows = args.includes("--direct-serena-rows") || args.includes("--require-direct-serena-rows");
const probeSerena = args.includes("--probe-serena") || args.includes("--require-live-serena") || directSerenaRows;
const requireLiveSerena = args.includes("--require-live-serena");
const requireDirectSerenaRows = args.includes("--require-direct-serena-rows");
const requestedProjects = valuesForArg("--project");
const serenaCommand = valuesForArg("--serena-command")[0] ?? "serena";
const serenaMcpError = valuesForArg("--serena-mcp-error")[0] ?? process.env.SERENA_MCP_ERROR ?? "";
const serenaPython = valuesForArg("--serena-python")[0] ?? process.env.SERENA_PYTHON ?? defaultSerenaPythonPath();
const directSerenaTimeoutMs = numberArg("--direct-serena-timeout-ms", 45_000);
const targets: RepoTarget[] = [
  { name: "context-mode", projectDir: contextModeRoot, archived: true },
  { name: "rust-navigation", projectDir: rustFixtureRoot },
  ...requestedProjects.map((projectDir) => ({ name: basename(resolve(projectDir)), projectDir: resolve(projectDir) })),
];
if (includeRealRepos) {
  targets.push(
    { name: "widget-launcher", projectDir: "C:\\Users\\chris\\Documents\\GitHub\\widget-launcher" },
    { name: "mission-control", projectDir: "C:\\Users\\chris\\Documents\\GitHub\\mission-control-master" },
  );
}

function valuesForArg(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) out.push(args[++i]);
    else if (args[i]?.startsWith(`${flag}=`)) out.push(args[i].slice(flag.length + 1));
  }
  return out;
}

function numberArg(flag: string, fallback: number): number {
  const raw = valuesForArg(flag)[0];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultSerenaPythonPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? "", "AppData", "Roaming");
    return join(appData, "uv", "tools", "serena-agent", "Scripts", "python.exe");
  }
  const home = process.env.HOME ?? "";
  return join(home, ".local", "share", "uv", "tools", "serena-agent", "bin", "python");
}

async function runProbe(command: string, probeArgs: readonly string[], timeoutMs: number): Promise<SerenaCommandProbe> {
  const started = Date.now();
  return new Promise((resolveProbe) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, [...probeArgs], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolveProbe({
        command,
        args: probeArgs,
        ok: false,
        timedOut: false,
        exitCode: null,
        elapsedMs: Date.now() - started,
        stdoutPreview: "",
        stderrPreview: "",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const finish = (exitCode: number | null, error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe({
        command,
        args: probeArgs,
        ok: !timedOut && exitCode === 0,
        timedOut,
        exitCode,
        elapsedMs: Date.now() - started,
        stdoutPreview: stdout.slice(0, 500),
        stderrPreview: stderr.slice(0, 500),
        ...(error ? { error } : {}),
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (proc.pid) {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
        if (process.platform === "win32") {
          try {
            execFileSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "pipe", timeout: 3_000, windowsHide: true });
          } catch { /* already dead or taskkill unavailable */ }
        }
      }
      finish(null, `timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 1000) stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 1000) stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => finish(null, err.message));
    proc.on("close", (code) => finish(code));
  });
}

async function runDirectSerenaRows(projectDir: string): Promise<SerenaDirectRowsProbe> {
  const command = serenaPython;
  const started = Date.now();
  if (!existsSync(command)) {
    return {
      command,
      ok: false,
      timedOut: false,
      exitCode: null,
      elapsedMs: Date.now() - started,
      rows: [],
      stdoutPreview: "",
      stderrPreview: "",
      error: "Serena Python runner not found",
    };
  }
  const pythonCode = String.raw`
import json
import os
import time
import traceback

started = time.time()
agent = None
rows = []

def add_row(scenario, fn):
    row_started = time.time()
    try:
        out = fn()
        text = str(out)
        rows.append({
            "scenario": scenario,
            "ok": True,
            "elapsedMs": int((time.time() - row_started) * 1000),
            "bytes": len(text.encode("utf-8")),
            "preview": text[:500],
        })
    except Exception as exc:
        rows.append({
            "scenario": scenario,
            "ok": False,
            "elapsedMs": int((time.time() - row_started) * 1000),
            "bytes": 0,
            "preview": "",
            "error": f"{type(exc).__name__}: {exc}",
        })

try:
    from serena.agent import SerenaAgent
    from serena.config.context_mode import SerenaAgentContext
    from serena.config.serena_config import SerenaConfig
    from serena.tools.symbol_tools import FindSymbolTool, GetSymbolsOverviewTool

    cfg = SerenaConfig(
        web_dashboard=False,
        web_dashboard_open_on_launch=False,
        gui_log_window=False,
        tool_timeout=max(5, int(os.environ.get("SERENA_DIRECT_TOOL_TIMEOUT_SECONDS", "30"))),
    )
    ctx = SerenaAgentContext(name="context-mode-benchmark", prompt="", single_project=True)
    agent = SerenaAgent(project=os.environ["SERENA_DIRECT_PROJECT"], serena_config=cfg, context=ctx)
    agent.reset_language_server_manager()
    overview = agent.get_tool(GetSymbolsOverviewTool)
    find = agent.get_tool(FindSymbolTool)
    add_row(
        "get_symbols_overview src/read/ctx-read.ts",
        lambda: overview.apply(relative_path="src/read/ctx-read.ts", depth=0, max_answer_chars=3000),
    )
    add_row(
        "find_symbol ctxRead location",
        lambda: find.apply(
            name_path_pattern="ctxRead",
            relative_path="src/read/ctx-read.ts",
            include_body=False,
            max_matches=1,
            max_answer_chars=3000,
        ),
    )
    add_row(
        "find_symbol ctxRead body",
        lambda: find.apply(
            name_path_pattern="ctxRead",
            relative_path="src/read/ctx-read.ts",
            include_body=True,
            max_matches=1,
            max_answer_chars=10000,
        ),
    )
    agent.on_shutdown(timeout=1.0)
    print(json.dumps({"ok": all(row["ok"] for row in rows), "elapsedMs": int((time.time() - started) * 1000), "rows": rows}))
except Exception as exc:
    if agent is not None:
        try:
            agent.on_shutdown(timeout=1.0)
        except Exception:
            pass
    print(json.dumps({
        "ok": False,
        "elapsedMs": int((time.time() - started) * 1000),
        "rows": rows,
        "error": f"{type(exc).__name__}: {exc}",
        "trace": traceback.format_exc()[-1200:],
    }))
`;
  return new Promise((resolveProbe) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let proc: ReturnType<typeof spawn>;
    const finish = (exitCode: number | null, error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = parseDirectRows(stdout);
      const rows = parsed.rows ?? [];
      const parseError = parsed.error;
      resolveProbe({
        command,
        ok: !timedOut && exitCode === 0 && parsed.ok === true && rows.length === archivedSerena.length && rows.every((row) => row.ok),
        timedOut,
        exitCode,
        elapsedMs: Date.now() - started,
        rows,
        stdoutPreview: stdout.slice(-2000),
        stderrPreview: stderr.slice(-2000),
        ...(error || parseError ? { error: [error, parseError].filter(Boolean).join("; ") } : {}),
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (proc?.pid) {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
        if (process.platform === "win32") {
          try {
            execFileSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "pipe", timeout: 3_000, windowsHide: true });
          } catch { /* already dead or taskkill unavailable */ }
        }
      }
      finish(null, `timed out after ${directSerenaTimeoutMs}ms`);
    }, directSerenaTimeoutMs);
    try {
      const serenaHome = join(sessionsDir, "serena-home");
      mkdirSync(serenaHome, { recursive: true });
      proc = spawn(command, ["-c", pythonCode], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          SERENA_HOME: serenaHome,
          SERENA_DIRECT_PROJECT: projectDir,
          SERENA_DIRECT_TOOL_TIMEOUT_SECONDS: String(Math.max(5, Math.floor(directSerenaTimeoutMs / 1000) - 5)),
        },
      });
    } catch (err) {
      clearTimeout(timer);
      resolveProbe({
        command,
        ok: false,
        timedOut: false,
        exitCode: null,
        elapsedMs: Date.now() - started,
        rows: [],
        stdoutPreview: "",
        stderrPreview: "",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 200_000) stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 50_000) stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => finish(null, err.message));
    proc.on("close", (code) => finish(code));
  });
}

function parseDirectRows(stdout: string): { ok?: boolean; rows?: SerenaDirectRow[]; error?: string } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as { ok?: boolean; rows?: SerenaDirectRow[]; error?: string; trace?: string };
      if (Array.isArray(parsed.rows)) {
        return { ok: parsed.ok, rows: parsed.rows, error: parsed.error ?? parsed.trace };
      }
    } catch { /* keep scanning */ }
  }
  return { error: "Serena direct runner did not emit parseable row JSON" };
}

async function detectSerenaAvailability(): Promise<SerenaAvailability> {
  const mcpTransport: SerenaAvailability["mcpTransport"] = serenaMcpError.trim()
    ? { status: "failed", error: serenaMcpError.trim() }
    : { status: "not-reported" };
  if (!probeSerena) {
    return {
      comparisonSource: "archived-only",
      archivedCapturedAt: "2026-05-21T00:31:36.319Z",
      archivedRows: archivedSerena.length,
      liveRequired: requireLiveSerena,
      liveProbeAttempted: false,
      liveUsable: false,
      directRowsRequested: directSerenaRows,
      directRowsRequired: requireDirectSerenaRows,
      directRowsAttempted: false,
      directRowsUsable: false,
      directRows: [],
      mcpTransport,
      blocker: requireLiveSerena
        ? "live Serena required but --probe-serena was not run"
        : requireDirectSerenaRows
          ? "direct Serena rows required but --direct-serena-rows was not run"
          : undefined,
    };
  }
  const whereProbe = process.platform === "win32"
    ? await runProbe("where.exe", [serenaCommand], 3_000)
    : await runProbe("which", [serenaCommand], 3_000);
  const executable = whereProbe.ok
    ? whereProbe.stdoutPreview.split(/\r?\n/).find(Boolean)?.trim()
    : serenaCommand;
  const versionProbe = await runProbe(executable || serenaCommand, ["--version"], 8_000);
  const directRowsProbe = directSerenaRows ? await runDirectSerenaRows(contextModeRoot) : undefined;
  const directRowsUsable = directRowsProbe?.ok === true;
  const liveUsable = versionProbe.ok && mcpTransport.status !== "failed";
  const liveIssue = liveUsable
    ? undefined
    : [
      mcpTransport.status === "failed" ? `MCP transport failed: ${mcpTransport.error}` : "",
      !whereProbe.ok ? `Serena executable probe failed${whereProbe.error ? `: ${whereProbe.error}` : ""}` : "",
      whereProbe.ok && !versionProbe.ok ? `Serena --version failed${versionProbe.timedOut ? " by timeout" : versionProbe.error ? `: ${versionProbe.error}` : ""}` : "",
    ].filter(Boolean).join("; ") || "Serena live probe did not produce a usable baseline";
  const directIssue = directSerenaRows && !directRowsUsable
    ? `direct Serena rows failed${directRowsProbe?.timedOut ? " by timeout" : directRowsProbe?.error ? `: ${directRowsProbe.error}` : ""}`
    : "";
  const blocker = [
    requireLiveSerena ? liveIssue : "",
    requireDirectSerenaRows ? directIssue : "",
  ].filter(Boolean).join("; ") || undefined;
  return {
    comparisonSource: directSerenaRows ? "archived-plus-live-probe-and-direct-rows" : "archived-plus-live-probe",
    archivedCapturedAt: "2026-05-21T00:31:36.319Z",
    archivedRows: archivedSerena.length,
    liveRequired: requireLiveSerena,
    liveProbeAttempted: true,
    liveUsable,
    directRowsRequested: directSerenaRows,
    directRowsRequired: requireDirectSerenaRows,
    directRowsAttempted: directSerenaRows,
    directRowsUsable,
    directRows: directRowsProbe?.rows ?? [],
    mcpTransport,
    executable,
    directRunner: directSerenaRows ? serenaPython : undefined,
    whereProbe,
    versionProbe,
    directRowsProbe,
    blocker,
  };
}

function context(projectDir: string): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: contextModeRoot,
    getSessionDir: () => sessionsDir,
    trackResponse: (_tool, response) => response,
  };
}

async function runCase(
  tool: ReturnType<typeof makeCtxCode>,
  ctx: ToolContext,
  label: string,
  input: Parameters<typeof tool.handler>[0],
): Promise<BenchmarkRow> {
  const started = Date.now();
  const result = await tool.handler(input, ctx);
  const text = result.content[0]?.text ?? "";
  return {
    label,
    ok: !result.isError,
    elapsedMs: Date.now() - started,
    bytes: Buffer.byteLength(text),
    preview: text.slice(0, 500),
    text,
  };
}

async function runArchivedContextModeTarget(target: RepoTarget): Promise<ArchivedResult> {
  const tool = makeCtxCode({ getProjectDir: () => target.projectDir });
  const ctx = context(target.projectDir);
  const rows = [
    await runCase(tool, ctx, "ctx_code file_outline src/read/ctx-read.ts", {
      action: "file_outline",
      file: "src/read/ctx-read.ts",
      compact: true,
      budgetBytes: 8192,
    }),
    await runCase(tool, ctx, "ctx_code find_symbol ctxRead location", {
      action: "find_symbol",
      query: "ctxRead",
      file: "src/read/ctx-read.ts",
      kind: "function",
      compact: true,
      limit: 1,
      budgetBytes: 4096,
    }),
    await runCase(tool, ctx, "ctx_code read_symbol ctxRead body", {
      action: "read_symbol",
      query: "ctxRead",
      file: "src/read/ctx-read.ts",
      kind: "function",
      budgetBytes: 8192,
    }),
  ];
  const comparisons = [
    {
      scenario: "overview",
      serenaBytes: archivedSerena[0].bytes,
      contextModeBytes: rows[0].bytes,
      pass: rows[0].bytes <= archivedSerena[0].bytes * 1.25,
    },
    {
      scenario: "symbol-location",
      serenaBytes: archivedSerena[1].bytes,
      contextModeBytes: rows[1].bytes,
      pass: rows[1].bytes <= archivedSerena[1].bytes * 1.5,
    },
    {
      scenario: "symbol-body",
      serenaBytes: archivedSerena[2].bytes,
      contextModeBytes: rows[2].bytes,
      pass: rows[2].bytes <= archivedSerena[2].bytes * 1.1,
    },
  ];
  return {
    target: target.name,
    projectDir: target.projectDir,
    kind: "archived-serena",
    ok: rows.every((row) => row.ok) && comparisons.every((row) => row.pass),
    rows,
    comparisons,
  };
}

async function runRealRepoTarget(target: RepoTarget): Promise<RealRepoResult | SkippedResult> {
  if (!existsSync(target.projectDir)) {
    return {
      target: target.name,
      projectDir: target.projectDir,
      kind: "real-repo",
      ok: false,
      skipped: true,
      reason: "project path missing",
      rows: [],
      checks: [],
    };
  }
  const candidates = candidatesForTarget(target);
  if (candidates.length === 0) {
    return {
      target: target.name,
      projectDir: target.projectDir,
      kind: "real-repo",
      ok: false,
      skipped: true,
      reason: "no TS/JS candidate symbol found",
      rows: [],
      checks: [],
    };
  }
  const tool = makeCtxCode({ getProjectDir: () => target.projectDir });
  const ctx = context(target.projectDir);
  const rows: BenchmarkRow[] = [];
  const checks: SmokeCheck[] = [];
  for (const candidate of candidates) {
    const label = `${candidate.file}::${candidate.symbol}`;
    const outline = await runCase(tool, ctx, `ctx_code file_outline ${label}`, {
      action: "file_outline",
      file: candidate.file,
      compact: true,
      budgetBytes: 8192,
    });
    const location = await runCase(tool, ctx, `ctx_code find_symbol ${label}`, {
      action: "find_symbol",
      query: candidate.symbol,
      file: candidate.file,
      kind: candidate.kind,
      compact: true,
      limit: 1,
      budgetBytes: 4096,
    });
    const body = await runCase(tool, ctx, `ctx_code read_symbol ${label}`, {
      action: "read_symbol",
      query: candidate.symbol,
      file: candidate.file,
      kind: candidate.kind,
      budgetBytes: 8192,
    });
    const refs = await runCase(tool, ctx, `ctx_code refs_light ${label}`, {
      action: "refs_light",
      symbol: candidate.symbol,
      file: candidate.file,
      limit: 20,
      budgetBytes: 8192,
    });
    const related = await runCase(tool, ctx, `ctx_code related_files ${candidate.file}`, {
      action: "related_files",
      file: candidate.file,
      limit: 12,
      budgetBytes: 8192,
    });
    const likelyTests = await runCase(tool, ctx, `ctx_code likely_tests ${candidate.file}`, {
      action: "likely_tests",
      file: candidate.file,
      limit: 12,
      budgetBytes: 4096,
    });
    const pack = await runCase(tool, ctx, `ctx_code pack ${label}`, {
      action: "pack",
      query: candidate.symbol,
      file: candidate.file,
      kind: candidate.kind,
      limit: 20,
      budgetBytes: 10 * 1024,
    });
    rows.push(outline, location, body, refs, related, likelyTests, pack);
    checks.push(
      { scenario: `${label}: outline-under-4kb`, bytes: outline.bytes, pass: outline.ok && outline.bytes <= 4096 },
      { scenario: `${label}: outline-semantic`, bytes: outline.bytes, pass: outline.ok && outline.text.includes(candidate.symbol) },
      { scenario: `${label}: location-under-1kb`, bytes: location.bytes, pass: location.ok && location.bytes <= 1024 },
      { scenario: `${label}: location-semantic`, bytes: location.bytes, pass: location.ok && location.text.includes(candidate.file) && location.text.includes(candidate.symbol) },
      { scenario: `${label}: body-under-8kb`, bytes: body.bytes, pass: body.ok && body.bytes <= 8192 },
      { scenario: `${label}: body-semantic`, bytes: body.bytes, pass: body.ok && body.text.includes("ctx_code read_symbol") && body.text.includes(candidate.symbol) },
      { scenario: `${label}: refs-under-8kb`, bytes: refs.bytes, pass: refs.ok && refs.bytes <= 8192 },
      { scenario: `${label}: refs-semantic`, bytes: refs.bytes, pass: refs.ok && refs.text.includes(`definition: ${candidate.file}:`) },
      { scenario: `${label}: related-under-8kb`, bytes: related.bytes, pass: related.ok && related.bytes <= 8192 },
      { scenario: `${label}: related-semantic`, bytes: related.bytes, pass: related.ok && related.text.includes("ctx_code related_files") && related.text.includes(candidate.file) && related.text.includes("likely_tests:") },
      { scenario: `${label}: likely-tests-under-4kb`, bytes: likelyTests.bytes, pass: likelyTests.ok && likelyTests.bytes <= 4096 },
      { scenario: `${label}: likely-tests-semantic`, bytes: likelyTests.bytes, pass: likelyTests.ok && likelyTests.text.includes("ctx_code likely_tests") && likelyTests.text.includes(candidate.file) },
      { scenario: `${label}: pack-under-10kb`, bytes: pack.bytes, pass: pack.ok && pack.bytes <= 10 * 1024 },
      { scenario: `${label}: pack-semantic`, bytes: pack.bytes, pass: pack.ok && pack.text.includes("ctx_code pack") && pack.text.includes("outline:") && pack.text.includes("symbol_slice:") },
    );
  }
  return {
    target: target.name,
    projectDir: target.projectDir,
    kind: "real-repo",
    ok: checks.every((row) => row.pass),
    candidate: candidates[0],
    candidates,
    rows,
    checks,
  };
}

function candidatesForTarget(target: RepoTarget): Candidate[] {
  const pinned = pinnedRealCandidates[target.name]
    ?.filter((candidate) => existsSync(join(target.projectDir, candidate.file))) ?? [];
  if (pinned.length > 0) return pinned;
  const candidate = findCandidate(target.projectDir);
  return candidate ? [candidate] : [];
}

function findCandidate(projectDir: string): Candidate | null {
  for (const file of scanCodeFiles(projectDir)) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const rel = relative(projectDir, file).replace(/\\/g, "/");
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const hit =
        /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line) ??
        /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/.exec(line) ??
        /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/.exec(line) ??
        /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/.exec(line) ??
        /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=/.exec(line) ??
        /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line) ??
        /^\s*class\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (!hit) continue;
      return { file: rel, symbol: hit[1], kind: inferKind(line) };
    }
  }
  return null;
}

function inferKind(line: string): string | undefined {
  if (/\bfunction\b/.test(line)) return "function";
  if (/\bclass\b/.test(line)) return "class";
  if (/\binterface\b/.test(line)) return "interface";
  if (/\btype\b/.test(line)) return "type";
  if (/\bconst\b/.test(line)) return undefined;
  return undefined;
}

function scanCodeFiles(projectDir: string): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "build", "dist", "coverage", ".next", ".context-mode"]);
  function walk(dir: string): void {
    if (out.length >= 500) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(full);
      } else if (entry.isFile() && /\.[cm]?[jt]sx?$/i.test(entry.name)) {
        try {
          if (statSync(full).size <= 500_000) out.push(full);
        } catch { /* skip */ }
      }
    }
  }
  walk(projectDir);
  return out.sort((a, b) => scoreFile(a) - scoreFile(b));
}

function scoreFile(file: string): number {
  const normalized = file.replace(/\\/g, "/");
  let score = 0;
  if (/\.test\.[jt]sx?$/.test(normalized) || /\.spec\.[jt]sx?$/.test(normalized)) score += 50;
  if (normalized.includes("/src/")) score -= 10;
  if (/\.(tsx|ts)$/.test(normalized)) score -= 5;
  return score;
}

const results: BenchmarkResult[] = [];
for (const target of targets) {
  results.push(target.archived ? await runArchivedContextModeTarget(target) : await runRealRepoTarget(target));
}

const serena = await detectSerenaAvailability();
const decision: "pass" | "not-ready" = results.every((result) => result.ok || (allowSkips && "skipped" in result && result.skipped === true))
  && (!serena.liveRequired || serena.liveUsable)
  && (!serena.directRowsRequired || serena.directRowsUsable)
  ? "pass"
  : "not-ready";
const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");
const payload: BenchmarkPayload = {
  generatedAt,
  decision,
  note: serena.directRowsUsable
    ? "Static ctx_code benchmark. Direct Serena row capture succeeded in a bounded external Python process; real repos remain smoke gates with byte budgets until Serena is stable enough for broad repo-level runs."
    : serena.liveUsable
      ? "Static ctx_code benchmark. Serena live executable/version probe is usable, but row-level live Serena baselines were not requested or did not produce usable direct rows."
    : "Static ctx_code benchmark. Context-mode archived rows compare against direct patched Serena rows captured on 2026-05-21; real repos are smoke gates with byte budgets. Live Serena is reported separately so transport/CLI failures do not become false comparison wins.",
  serena,
  archivedSerena,
  results,
};

const jsonPath = join(outDir, `serena-removal-${stamp}.json`);
const mdPath = join(outDir, `serena-removal-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
writeFileSync(mdPath, renderMarkdown(payload));

console.log(JSON.stringify({
  decision,
  jsonPath,
  mdPath,
    serena: {
      comparisonSource: serena.comparisonSource,
      liveProbeAttempted: serena.liveProbeAttempted,
      liveUsable: serena.liveUsable,
      liveRequired: serena.liveRequired,
      directRowsAttempted: serena.directRowsAttempted,
      directRowsUsable: serena.directRowsUsable,
      directRowsRequired: serena.directRowsRequired,
      blocker: serena.blocker,
    },
  results: results.map((result) => ({
    target: result.target,
    kind: result.kind,
    ok: result.ok,
    skipped: "skipped" in result && result.skipped === true,
    candidate: "candidate" in result ? result.candidate : undefined,
    candidates: "candidates" in result ? result.candidates : undefined,
    comparisons: "comparisons" in result ? result.comparisons : result.checks,
  })),
}, null, 2));
if (check && decision !== "pass") process.exit(1);

function renderMarkdown(payload: BenchmarkPayload): string {
  const lines = [
    "# Serena Removal Gate",
    "",
    `Generated: ${payload.generatedAt}`,
    `Decision: ${payload.decision}`,
    "",
    "## Serena Baseline",
    "",
    `Comparison source: ${payload.serena.comparisonSource}`,
    `Archived captured at: ${payload.serena.archivedCapturedAt}`,
    `Archived rows: ${payload.serena.archivedRows}`,
    `Live probe attempted: ${payload.serena.liveProbeAttempted ? "yes" : "no"}`,
    `Live required: ${payload.serena.liveRequired ? "yes" : "no"}`,
    `Live usable: ${payload.serena.liveUsable ? "yes" : "no"}`,
    `Direct rows requested: ${payload.serena.directRowsRequested ? "yes" : "no"}`,
    `Direct rows required: ${payload.serena.directRowsRequired ? "yes" : "no"}`,
    `Direct rows attempted: ${payload.serena.directRowsAttempted ? "yes" : "no"}`,
    `Direct rows usable: ${payload.serena.directRowsUsable ? "yes" : "no"}`,
    `MCP transport: ${payload.serena.mcpTransport.status}${payload.serena.mcpTransport.error ? ` (${payload.serena.mcpTransport.error})` : ""}`,
    payload.serena.executable ? `Executable: ${payload.serena.executable}` : "",
    payload.serena.directRunner ? `Direct runner: ${payload.serena.directRunner}` : "",
    payload.serena.versionProbe ? `Version probe: ${payload.serena.versionProbe.ok ? "ok" : payload.serena.versionProbe.timedOut ? "timeout" : "failed"} (${payload.serena.versionProbe.elapsedMs} ms)` : "",
    payload.serena.directRowsProbe ? `Direct rows probe: ${payload.serena.directRowsProbe.ok ? "ok" : payload.serena.directRowsProbe.timedOut ? "timeout" : "failed"} (${payload.serena.directRowsProbe.elapsedMs} ms)` : "",
    payload.serena.blocker ? `Blocker: ${payload.serena.blocker}` : "",
    "",
  ];
  if (payload.serena.directRows.length > 0) {
    lines.push("| Direct Serena scenario | Bytes | Time | Result |");
    lines.push("|---|---:|---:|---|");
    for (const row of payload.serena.directRows) {
      lines.push(`| ${row.scenario} | ${row.bytes} | ${row.elapsedMs} ms | ${row.ok ? "ok" : row.error ?? "fail"} |`);
    }
    lines.push("");
  }
  for (const result of payload.results) {
    lines.push(`## ${result.target}`, "");
    lines.push(`Project: ${result.projectDir}`);
    if ("skipped" in result && result.skipped === true) {
      lines.push(`Skipped: ${result.reason}`, "");
      continue;
    }
    if ("candidates" in result) lines.push(`Candidates: ${result.candidates.map((candidate) => `${candidate.file} :: ${candidate.symbol}`).join(", ")}`, "");
    lines.push("| Scenario | Bytes | Time | Result |");
    lines.push("|---|---:|---:|---|");
    for (const row of result.rows) {
      lines.push(`| ${row.label} | ${row.bytes} | ${row.elapsedMs} ms | ${row.ok ? "ok" : "fail"} |`);
    }
    const comparisons = "comparisons" in result ? result.comparisons : result.checks;
    lines.push("", "| Gate | Baseline/Budget | Context Mode bytes | Result |");
    lines.push("|---|---:|---:|---|");
    for (const row of comparisons) {
      const baseline = "serenaBytes" in row ? row.serenaBytes : row.scenario;
      const bytes = "contextModeBytes" in row ? row.contextModeBytes : row.bytes;
      lines.push(`| ${row.scenario} | ${baseline} | ${bytes} | ${row.pass ? "pass" : "not-ready"} |`);
    }
    lines.push("");
  }
  lines.push(payload.note, "");
  return lines.join("\n");
}
