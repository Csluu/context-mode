/**
 * tools/upgrade — `ctx_upgrade` MCP tool: returns a shell command the host
 * runs to pull, build, and install the latest context-mode.
 *
 * First extraction per src/tools/MIGRATION.md. Closure deps that were
 * previously captured implicitly from server.ts are now passed through
 * explicit factory arguments (`UpgradeDeps`) plus the shared `ToolContext`.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
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
  "Upgrade context-mode to the latest version. Returns a shell command to execute. " +
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
        // Inline fallback: neither CLI file exists (marketplace installs).
        // Emit a self-contained node script that clones, builds, copies.
        // Written to a .mjs file rather than `node -e '...'` to avoid quote
        // escaping pain across cmd.exe / PowerShell / bash.
        const repoUrl = "https://github.com/mksglu/context-mode.git";
        const scriptLines = [
          `import{execFileSync}from"node:child_process";`,
          `import{cpSync,rmSync,existsSync,mkdtempSync,readFileSync,writeFileSync}from"node:fs";`,
          `import{join}from"node:path";`,
          `import{tmpdir}from"node:os";`,
          `const P=${JSON.stringify(pluginRoot)};`,
          `const T=mkdtempSync(join(tmpdir(),"ctx-upgrade-"));`,
          `try{`,
          `console.log("- [x] Starting inline upgrade (no CLI found)");`,
          `execFileSync("git",["clone","--depth","1","${repoUrl}",T],{stdio:"inherit"});`,
          `console.log("- [x] Cloned latest source");`,
          `execFileSync(process.platform==="win32"?"npm.cmd":"npm",["install"],{cwd:T,stdio:"inherit",shell:process.platform==="win32"});`,
          `execFileSync(process.platform==="win32"?"npm.cmd":"npm",["run","build"],{cwd:T,stdio:"inherit",shell:process.platform==="win32"});`,
          `console.log("- [x] Built from source");`,
          `const pkg=JSON.parse(readFileSync(join(T,"package.json"),"utf8"));`,
          `const items=[...(Array.isArray(pkg.files)?pkg.files:[]),"src","package.json"];`,
          `for(const item of items){const from=join(T,item);const to=join(P,item);if(existsSync(from)){rmSync(to,{recursive:true,force:true});cpSync(from,to,{recursive:true,force:true});}}`,
          `writeFileSync(join(P,".mcp.json"),JSON.stringify({mcpServers:{"context-mode":{command:"node",args:["\${CLAUDE_PLUGIN_ROOT}/start.mjs"]}}},null,2)+"\\n");`,
          `console.log("- [x] Copied package files");`,
          `execFileSync(process.platform==="win32"?"npm.cmd":"npm",["install","--production"],{cwd:P,stdio:"inherit",shell:process.platform==="win32"});`,
          `console.log("- [x] Installed production dependencies");`,
          `console.log("## context-mode upgrade complete");`,
          `}catch(e){`,
          `console.error("- [ ] Upgrade failed:",e.message);`,
          `process.exit(1);`,
          `}finally{`,
          `try{rmSync(T,{recursive:true,force:true})}catch{}`,
          `}`,
        ].join("\n");

        const tmpScript = resolve(pluginRoot, ".ctx-upgrade-inline.mjs");
        writeFileSync(tmpScript, scriptLines);
        cmd = deps.buildNodeCommand(tmpScript);
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
