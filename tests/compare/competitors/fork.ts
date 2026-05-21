// Fork adapter: invoke the local context-mode MCP server via stdio JSON-RPC.
// Each runCommand maps to ctx_execute; each readFile maps to ctx_read.
// Mirrors the shape comparison tests already use in suite.ts.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  type CompetitorAdapter,
  type CompetitorRunResult,
  type FetchUrlOpts,
  type IndexOpts,
  type ReadFileOpts,
  type RunCommandOpts,
  type SearchOpts,
  estimateTokens,
} from "./lib.js";

function clipKeep(text: string): string { return text.slice(0, 6000); }

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SERVER_ENTRY = resolve(REPO_ROOT, "build", "server.js");

interface PendingCall {
  resolve(value: any): void;
  reject(reason: any): void;
}

class ForkMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  async start(): Promise<void> {
    if (this.child) return;
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(`fork build missing — expected ${SERVER_ENTRY}. Run \`npm run build\` first.`);
    }
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CONTEXT_MODE_SUPPRESS_VERSION_CHECK: "1",
        // Allow project-dir override for tmp-file workflows.
        CONTEXT_MODE_ALLOW_PROJECT_OVERRIDE: "1",
      },
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    child.stderr.on("data", () => { /* ignore — server emits diagnostics here */ });
    child.on("exit", () => { this.child = null; });
    await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "context-mode-competitor-harness", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    try { this.child.kill(); } catch { /* ignore */ }
    this.child = null;
  }

  private onStdout(chunk: Buffer): void {
    this.buf += chunk.toString("utf8");
    let idx = this.buf.indexOf("\n");
    while (idx >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      idx = this.buf.indexOf("\n");
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
      }
    }
  }

  private send(payload: any): void {
    if (!this.child) throw new Error("fork client not started");
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  private notify(method: string, params: any): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  rpc(method: string, params: any, timeoutMs = 60_000): Promise<any> {
    return new Promise((resolveFn, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolveFn, reject });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`fork rpc timeout: ${method}`));
        }
      }, timeoutMs);
      const wrapResolve = (value: any) => { clearTimeout(timer); resolveFn(value); };
      const wrapReject = (reason: any) => { clearTimeout(timer); reject(reason); };
      this.pending.set(id, { resolve: wrapResolve, reject: wrapReject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async callTool(name: string, args: any): Promise<{ bytes: number; text: string; isError: boolean }> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    const content = (result?.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.map((c) => c.text ?? "").join("");
    return {
      bytes: Buffer.byteLength(text, "utf8"),
      text,
      isError: Boolean(result?.isError),
    };
  }
}

let _client: ForkMcpClient | null = null;
async function getClient(): Promise<ForkMcpClient> {
  if (!_client) {
    _client = new ForkMcpClient();
    await _client.start();
  }
  return _client;
}

export async function shutdownForkClient(): Promise<void> {
  if (_client) {
    await _client.stop();
    _client = null;
  }
}

export const forkAdapter: CompetitorAdapter = {
  id: "fork",
  description: "Local context-mode MCP server (this repo) — ctx_execute / ctx_read.",
  async detect() {
    if (!existsSync(SERVER_ENTRY)) {
      return { available: false, reason: `build missing at ${SERVER_ENTRY}` };
    }
    let installSizeBytes = 0;
    try {
      const { readdirSync, statSync } = await import("node:fs");
      const buildDir = resolve(REPO_ROOT, "build");
      const walk = (d: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = `${d}/${e.name}`;
          if (e.isDirectory()) walk(p);
          else if (e.isFile()) try { installSizeBytes += statSync(p).size; } catch { /* ignore */ }
        }
      };
      walk(buildDir);
    } catch { /* ignore */ }
    return { available: true, version: "local-build", installSizeBytes };
  },
  async runCommand(cmd: string, opts: RunCommandOpts = {}): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
      const r = await client.callTool("ctx_execute", {
        language: "shell",
        code: cmd,
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 60_000,
      });
      return {
        tool: "fork",
        stepLabel: cmd.slice(0, 40),
        ms: Date.now() - started,
        bytes: r.bytes,
        tokens: estimateTokens(r.bytes),
        ok: !r.isError,
        errorReason: r.isError ? "ctx_execute reported isError" : undefined,
        output: opts.keepOutput ? clipKeep(r.text) : undefined,
      };
    } catch (err) {
      return {
        tool: "fork",
        stepLabel: cmd.slice(0, 40),
        ms: Date.now() - started,
        bytes: 0,
        tokens: 0,
        ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async readFile(path: string, opts: ReadFileOpts = {}): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
      // Pass an explicit projectDir for absolute paths outside the repo
      // (tmp-file workflows). Fork's read policy otherwise refuses.
      const projectDir = isAbsolute(path) && !path.startsWith(REPO_ROOT) ? dirname(path) : undefined;
      const r = await client.callTool("ctx_read", {
        path,
        projectDir,
        mode: opts.mode ?? "auto",
        start: opts.start,
        end: opts.end,
        compact: opts.compact,
        reason: opts.mode === "full" ? "competitor-baseline harness" : undefined,
      });
      return {
        tool: "fork",
        stepLabel: `read:${path}`,
        ms: Date.now() - started,
        bytes: r.bytes,
        tokens: estimateTokens(r.bytes),
        ok: !r.isError,
        errorReason: r.isError ? "ctx_read reported isError" : undefined,
        output: opts.keepOutput ? clipKeep(r.text) : undefined,
      };
    } catch (err) {
      return {
        tool: "fork",
        stepLabel: `read:${path}`,
        ms: Date.now() - started,
        bytes: 0,
        tokens: 0,
        ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async fetchUrl(url: string, opts: FetchUrlOpts = {}): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
      const r = await client.callTool("ctx_fetch_and_index", {
        url,
        source: `bench-${Date.now()}`,
      });
      return {
        tool: "fork",
        stepLabel: `fetch:${url.slice(0, 40)}`,
        ms: Date.now() - started,
        bytes: r.bytes,
        tokens: estimateTokens(r.bytes),
        ok: !r.isError,
        errorReason: r.isError ? "ctx_fetch_and_index reported isError" : undefined,
        output: opts.keepOutput ? clipKeep(r.text) : undefined,
      };
    } catch (err) {
      return {
        tool: "fork", stepLabel: `fetch:${url.slice(0, 40)}`,
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async index(opts: IndexOpts): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
      // ctx_index for a directory tree; ctx_batch_execute for a command.
      let r;
      if (opts.command) {
        r = await client.callTool("ctx_batch_execute", {
          commands: [{ label: opts.source, command: opts.command }],
          queries: [],
        });
      } else if (opts.path) {
        r = await client.callTool("ctx_index", {
          path: opts.path,
          source: opts.source,
        });
      } else {
        throw new Error("index step requires path or command");
      }
      return {
        tool: "fork",
        stepLabel: `index:${opts.source}`,
        ms: Date.now() - started,
        bytes: r.bytes,
        tokens: estimateTokens(r.bytes),
        ok: !r.isError,
        errorReason: r.isError ? "ctx_index reported isError" : undefined,
        output: opts.keepOutput ? clipKeep(r.text) : undefined,
      };
    } catch (err) {
      return {
        tool: "fork", stepLabel: `index:${opts.source}`,
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async search(query: string, opts: SearchOpts = {}): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
      const r = await client.callTool("ctx_search", {
        queries: [query],
        source: opts.source,
        limit: 3,
      });
      return {
        tool: "fork",
        stepLabel: `search:${query.slice(0, 30)}`,
        ms: Date.now() - started,
        bytes: r.bytes,
        tokens: estimateTokens(r.bytes),
        ok: !r.isError,
        errorReason: r.isError ? "ctx_search reported isError" : undefined,
        output: opts.keepOutput ? clipKeep(r.text) : undefined,
      };
    } catch (err) {
      return {
        tool: "fork", stepLabel: `search:${query.slice(0, 30)}`,
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// fork-intent variant: same MCP client, but ctx_execute calls pass an `intent`
// so output > 5KB is indexed into KB and reduced to section titles + preview.
// This is fork's killer feature — without it, big outputs pass through raw.
export const forkIntentAdapter: CompetitorAdapter = {
  ...forkAdapter,
  id: "fork-intent",
  description: "Fork (this repo) WITH intent-driven indexing — ctx_execute(intent) sidecars large outputs.",
  async detect() { return forkAdapter.detect(); },
  async runCommand(cmd: string, opts: RunCommandOpts = {}): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
      // Generic intent — bench mimics an agent that always says "look for the
      // signal in this output." Real agents craft intent per task.
      const r = await client.callTool("ctx_execute", {
        language: "shell",
        code: cmd,
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 60_000,
        intent: "important markers errors warnings result summary",
      });
      return {
        tool: "fork-intent",
        stepLabel: cmd.slice(0, 40),
        ms: Date.now() - started,
        bytes: r.bytes,
        tokens: estimateTokens(r.bytes),
        ok: !r.isError,
        errorReason: r.isError ? "ctx_execute reported isError" : undefined,
        output: opts.keepOutput ? clipKeep(r.text) : undefined,
      };
    } catch (err) {
      return {
        tool: "fork-intent", stepLabel: cmd.slice(0, 40),
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
