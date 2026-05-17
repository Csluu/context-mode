/**
 * tools/doctor — `ctx_doctor` MCP tool: diagnostic checks for runtimes,
 * SQLite/FTS5, hook scripts, and the issue-#592 idle-shutdown sanity check.
 *
 * Second extraction per src/tools/MIGRATION.md. The handler renders a
 * plain-text report (no markdown task-list syntax — see Mickey #3 / Z.ai
 * renderer ReferenceError).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import type { HookAdapter } from "../adapters/types.js";
import { PolyglotExecutor } from "../executor.js";
import { loadDatabase } from "../db-base.js";
import { detectRuntimes, getAvailableLanguages, hasBunRuntime, type Language, type RuntimeMap } from "../runtime.js";
import { getHookScriptPaths } from "../util/hook-config.js";

import type { ToolContext, ToolDefinition } from "./types.js";

export interface DoctorDeps {
  /** Plugin version string from package.json. */
  readonly VERSION: string;
  /** Resolve the adapter to validate hooks against (Promise<HookAdapter | null>). */
  readonly getDiagnosticAdapter: () => Promise<HookAdapter | null>;
}

const description =
  "Diagnose context-mode installation. Runs all checks server-side and " +
  "returns a plain-text status report with [OK]/[FAIL]/[WARN] prefixes " +
  "(renderer-safe across MCP clients). No CLI execution needed.";

const IDLE_AFFECTED_HOSTS: ReadonlySet<string> = new Set([
  "claude-code", "codex", "cursor", "gemini-cli",
  "vscode-copilot", "jetbrains-copilot", "antigravity", "zed",
]);

export function makeCtxDoctor(deps: DoctorDeps): ToolDefinition {
  return {
    name: "ctx_doctor",
    config: {
      title: "Run Diagnostics",
      description,
      inputSchema: z.object({}),
    },
    handler: async (_input: unknown, ctx: ToolContext): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const lines: string[] = ["context-mode doctor", ""];
      const pluginRoot = ctx.pluginRoot;

      // Runtimes — recompute here (cheap; idempotent).
      const runtimes: RuntimeMap = detectRuntimes();
      const available: Language[] = getAvailableLanguages(runtimes);
      const total = 11;
      const pct = ((available.length / total) * 100).toFixed(0);
      lines.push(`[OK] Runtimes: ${available.length}/${total} (${pct}%) — ${available.join(", ")}`);

      // Performance
      if (hasBunRuntime()) {
        lines.push("[OK] Performance: FAST (Bun)");
      } else {
        lines.push("[WARN] Performance: NORMAL — install Bun for 3-5x speed boost");
      }

      // Server execution test — cleanup executor to prevent resource leaks (#247).
      {
        const testExecutor = new PolyglotExecutor({ runtimes });
        try {
          const result = await testExecutor.execute({
            language: "javascript",
            code: 'console.log("ok");',
            timeout: 5000,
          });
          if (result.exitCode === 0 && result.stdout.trim() === "ok") {
            lines.push("[OK] Server test: PASS");
          } else {
            const detail = result.stderr?.trim() ? ` (${result.stderr.trim().slice(0, 200)})` : "";
            lines.push(`[FAIL] Server test: FAIL — exit ${result.exitCode}${detail}`);
          }
        } catch (err: unknown) {
          lines.push(`[FAIL] Server test: FAIL — ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          testExecutor.cleanupBackgrounded();
        }
      }

      // FTS5 / SQLite — close in finally to prevent GC segfault (#247).
      {
        let testDb: ReturnType<ReturnType<typeof loadDatabase>> | undefined;
        try {
          const Database = loadDatabase();
          testDb = new Database(":memory:");
          testDb.exec("CREATE VIRTUAL TABLE fts_test USING fts5(content)");
          testDb.exec("INSERT INTO fts_test(content) VALUES ('hello world')");
          const row = testDb
            .prepare("SELECT * FROM fts_test WHERE fts_test MATCH 'hello'")
            .get() as { content: string } | undefined;
          if (row && row.content === "hello world") {
            lines.push("[OK] FTS5 / SQLite: PASS — native module works");
          } else {
            lines.push("[FAIL] FTS5 / SQLite: FAIL — unexpected result");
          }
        } catch (err: unknown) {
          lines.push(`[FAIL] FTS5 / SQLite: FAIL — ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          try { testDb?.close(); } catch { /* best effort */ }
        }
      }

      // Hook scripts
      const diagnosticAdapter = await deps.getDiagnosticAdapter();
      if (diagnosticAdapter) {
        for (const result of diagnosticAdapter.validateHooks(pluginRoot)) {
          const prefix = result.status === "pass" ? "[OK]" : result.status === "warn" ? "[WARN]" : "[FAIL]";
          const fix = result.fix ? ` — fix: ${result.fix}` : "";
          lines.push(`${prefix} ${result.check}: ${result.message}${fix}`);
        }

        const hookScriptPaths = getHookScriptPaths(diagnosticAdapter, pluginRoot);
        if (hookScriptPaths.length === 0) {
          lines.push("[OK] Hook scripts: no direct .mjs script paths to verify");
        }
        for (const scriptPath of hookScriptPaths) {
          const hookPath = resolve(pluginRoot, scriptPath);
          if (existsSync(hookPath)) {
            lines.push(`[OK] Hook script: PASS — ${hookPath}`);
          } else {
            lines.push(`[FAIL] Hook script: FAIL — not found at ${hookPath}`);
          }
        }
      } else {
        lines.push("[WARN] Hooks: adapter detection unavailable");
      }

      // Idle-shutdown sanity check (#592). Hosts in IDLE_AFFECTED_HOSTS do not
      // auto-respawn the MCP child after clean exit, so a non-zero idle
      // timeout strands every ctx_* tool as "MCP server disconnected" until
      // the user manually reloads. Emit a FIX command when the bad combo is
      // detected.
      {
        let detectedHost = "";
        try {
          const { detectPlatform } = await import("../adapters/detect.js");
          detectedHost = detectPlatform()?.platform ?? "";
        } catch { /* best effort */ }
        const raw = process.env.CONTEXT_MODE_IDLE_TIMEOUT_MS;
        const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
        const idleActive = Number.isFinite(parsed) && parsed > 0;
        if (detectedHost && IDLE_AFFECTED_HOSTS.has(detectedHost) && idleActive) {
          const setCmd = process.platform === "win32"
            ? "setx CONTEXT_MODE_IDLE_TIMEOUT_MS 0"
            : "export CONTEXT_MODE_IDLE_TIMEOUT_MS=0   # add to ~/.bashrc or ~/.zshrc";
          lines.push(
            `[WARN] Idle shutdown: CONTEXT_MODE_IDLE_TIMEOUT_MS=${raw} on host '${detectedHost}' — ` +
            `this host does not auto-respawn the MCP child (issue #592). ` +
            `Fix: ${setCmd}`,
          );
        } else {
          lines.push(`[OK] Idle shutdown: safe (host=${detectedHost || "unknown"}, idle=${raw ?? "default"})`);
        }
      }

      // Version
      lines.push(`[OK] Version: v${deps.VERSION}`);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  };
}
