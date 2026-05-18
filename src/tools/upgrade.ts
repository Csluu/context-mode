/**
 * tools/upgrade — `ctx_upgrade` MCP tool: returns a shell command the host
 * runs to pull, build, and install the latest context-mode.
 *
 * First extraction per src/tools/MIGRATION.md. Closure deps that were
 * previously captured implicitly from server.ts are now passed through
 * explicit factory arguments (`UpgradeDeps`) plus the shared `ToolContext`.
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

import { z } from "zod";

import type { ToolContext, ToolDefinition } from "./types.js";

/**
 * Per-tool dependencies that the registry cannot supply on its own —
 * single-call-site helpers that live elsewhere in the codebase. Keeping
 * them in a typed factory parameter rather than a fat ToolContext
 * preserves call-site clarity: server.ts wires only what this tool needs.
 */
export interface UpgradeDeps {
  /** Build the platform-correct `node <path>` invocation string. */
  readonly buildNodeCommand: (path: string) => string;
  /** Kill any process listening on the given TCP port. Best effort. */
  readonly killProcessOnPort: (port: number) => unknown;
}

const description =
  "Upgrade context-mode to the latest version when explicitly enabled. Returns a shell command to execute. " +
  "You MUST run the returned command using your shell tool (Bash, shell_execute, " +
  "run_in_terminal, etc.) and display the output as a checklist. " +
  "Tell the user to restart their session after upgrade.";

export function makeCtxUpgrade(deps: UpgradeDeps): ToolDefinition {
  return {
    name: "ctx_upgrade",
    config: {
      title: "Upgrade Plugin",
      description,
      inputSchema: z.object({}),
    },
    handler: async (_input: unknown, ctx: ToolContext): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      if (process.env.CONTEXT_MODE_ALLOW_UNPINNED_UPGRADE !== "1") {
        return {
          content: [{
            type: "text" as const,
            text: [
              "## ctx-upgrade",
              "",
              "Upgrade command disabled for this fork.",
              "",
              "`context-mode upgrade` currently fetches mutable upstream state. To avoid supply-chain drift, this MCP tool will not hand agents an upgrade command unless `CONTEXT_MODE_ALLOW_UNPINNED_UPGRADE=1` is set.",
              "",
              "For this private fork, upgrade from a reviewed local checkout instead: pull the intended commit, run tests, then rebuild/install from that checkout.",
            ].join("\n"),
          }],
        };
      }

      const pluginRoot = ctx.pluginRoot;
      const bundlePath = resolve(pluginRoot, "cli.bundle.mjs");
      const fallbackPath = resolve(pluginRoot, "build", "cli.js");

      // Clean up insight-cache on upgrade so next ctx_insight does fresh build.
      // Locale-independent on Windows (PR #469). Failures here MUST NOT block
      // ctx_upgrade — cache cleanup is best-effort.
      try {
        const sessDir = ctx.getSessionDir();
        const insightCacheDir = join(dirname(sessDir), "insight-cache");
        if (existsSync(insightCacheDir)) {
          deps.killProcessOnPort(4747);
          rmSync(insightCacheDir, { recursive: true, force: true });
        }
      } catch { /* best effort */ }

      // Issue #542 — thread MCP clientInfo into the spawned upgrade process.
      // detectPlatform() runs in-process here (no spawn boundary) so the
      // handshake-derived clientInfo is the highest-confidence signal
      // available. Forward as a `--platform` flag (cross-shell safe).
      let platformFlag = "";
      try {
        const { detectPlatform } = await import("../adapters/detect.js");
        const clientInfo = ctx.server.server.getClientVersion();
        const signal = detectPlatform(clientInfo ?? undefined);
        platformFlag = ` --platform ${signal.platform}`;
      } catch { /* fall back to upgrade()'s own detect */ }

      let cmd: string;

      if (existsSync(bundlePath)) {
        cmd = `${deps.buildNodeCommand(bundlePath)} upgrade${platformFlag}`;
      } else if (existsSync(fallbackPath)) {
        cmd = `${deps.buildNodeCommand(fallbackPath)} upgrade${platformFlag}`;
      } else {
        return {
          content: [{
            type: "text" as const,
            text: [
              "## ctx-upgrade",
              "",
              "Upgrade unavailable: neither `cli.bundle.mjs` nor `build/cli.js` exists in this install.",
              "",
              "Refusing the old inline fallback because it cloned the latest GitHub branch and ran `npm install` without a pinned commit, checksum, or signature.",
              "",
              "Use a trusted package-manager upgrade or reinstall from a reviewed local checkout instead.",
            ].join("\n"),
          }],
        };
      }

      const text = [
        "## ctx-upgrade",
        "",
        "Run this command using your shell execution tool:",
        "",
        "```",
        cmd,
        "```",
        "",
        "After the command completes, display results as a markdown checklist:",
        "- `[x]` for success, `[ ]` for failure",
        "- Example format:",
        "  ```",
        "  ## context-mode upgrade",
        "  - [x] Pulled latest from GitHub",
        "  - [x] Built and installed v0.9.24",
        "  - [x] npm global updated",
        "  - [x] Hooks configured",
        "  - [x] Doctor: all checks PASS",
        "  ```",
        "- Tell the user to restart their session to pick up the new version.",
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  };
}
