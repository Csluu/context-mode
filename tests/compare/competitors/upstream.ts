// Upstream context-mode adapter (mksglu/context-mode at pinned SHA).
// Spawns .compare/upstream/server.bundle.mjs via MCP stdio JSON-RPC.
//
// Same code path as fork.ts but points to upstream's bundled entry. No intent
// variant — upstream + fork share the intent feature, so fork-intent already
// covers that comparison angle.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
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

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const UPSTREAM_DIR = resolve(REPO_ROOT, ".compare", "upstream");
const UPSTREAM_ENTRY = resolve(UPSTREAM_DIR, "server.bundle.mjs");

function clipKeep(text: string): string { return text.slice(0, 6000); }

interface PendingCall {
  resolve(value: any): void;
  reject(reason: any): void;
}

class UpstreamMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  async start(): Promise<void> {
    if (this.child) return;
    if (!existsSync(UPSTREAM_ENTRY)) {
      throw new Error(`upstream bundle missing — expected ${UPSTREAM_ENTRY}. Run \`npm run compare:setup\` first.`);
    }
    const child = spawn(process.execPath, [UPSTREAM_ENTRY], {
      cwd: UPSTREAM_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CONTEXT_MODE_SUPPRESS_VERSION_CHECK: "1",
        CONTEXT_MODE_ALLOW_PROJECT_OVERRIDE: "1",
      },
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    child.stderr.on("data", () => { /* ignore — upstream emits diagnostics */ });
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
    if (!this.child) throw new Error("upstream client not started");
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  private notify(method: string, params: any): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  rpc(method: string, params: any, timeoutMs = 60_000): Promise<any> {
    return new Promise((_resolveFn, _reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          _reject(new Error(`upstream rpc timeout: ${method}`));
        }
      }, timeoutMs);
      const wrapResolve = (value: any) => { clearTimeout(timer); _resolveFn(value); };
      const wrapReject = (reason: any) => { clearTimeout(timer); _reject(reason); };
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

let _client: UpstreamMcpClient | null = null;
async function getClient(): Promise<UpstreamMcpClient> {
  if (!_client) {
    _client = new UpstreamMcpClient();
    await _client.start();
  }
  return _client;
}

export async function shutdownUpstreamClient(): Promise<void> {
  if (_client) {
    await _client.stop();
    _client = null;
  }
}

function readUpstreamVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(UPSTREAM_DIR, "package.json"), "utf8"));
    return `upstream v${pkg.version}`;
  } catch { return "upstream"; }
}

function upstreamInstallSize(): number {
  let total = 0;
  try {
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) try { total += statSync(p).size; } catch { /* ignore */ }
      }
    };
    walk(UPSTREAM_DIR);
  } catch { /* ignore */ }
  return total;
}

export const upstreamAdapter: CompetitorAdapter = {
  id: "upstream",
  description: "Upstream mksglu/context-mode at pinned SHA — same lineage as fork, no fork patches.",
  async detect() {
    if (!existsSync(UPSTREAM_ENTRY)) {
      return { available: false, reason: `upstream not built — run npm run compare:setup` };
    }
    return { available: true, version: readUpstreamVersion(), installSizeBytes: upstreamInstallSize() };
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
        tool: "upstream",
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
        tool: "upstream", stepLabel: cmd.slice(0, 40),
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async readFile(path: string, opts: ReadFileOpts = {}): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
      const projectDir = isAbsolute(path) && !path.startsWith(REPO_ROOT) ? dirname(path) : undefined;
      const r = await client.callTool("ctx_read", {
        path,
        projectDir,
        mode: opts.mode ?? "auto",
        start: opts.start,
        end: opts.end,
        // Upstream may not support `compact` arg yet — pass it; if rejected it
        // falls back to default.
        compact: opts.compact,
        reason: opts.mode === "full" ? "competitor-baseline harness" : undefined,
      });
      return {
        tool: "upstream",
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
        tool: "upstream", stepLabel: `read:${path}`,
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
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
        tool: "upstream",
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
        tool: "upstream", stepLabel: `fetch:${url.slice(0, 40)}`,
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async index(opts: IndexOpts): Promise<CompetitorRunResult> {
    const client = await getClient();
    const started = Date.now();
    try {
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
        tool: "upstream",
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
        tool: "upstream", stepLabel: `index:${opts.source}`,
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
        tool: "upstream",
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
        tool: "upstream", stepLabel: `search:${query.slice(0, 30)}`,
        ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
