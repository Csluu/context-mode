// Minimal MCP stdio JSON-RPC client. Spawns a server bundle, performs
// `initialize`, then exposes `call(toolName, args)` returning the raw result
// plus wall-clock ms. No SDK dep — line-delimited JSON over stdin/stdout.
//
// Bytes accounting (intentional):
//   - `payloadBytes` — sum of UTF-8 bytes across content[*].text. This is
//     what enters the model context, and is the figure used for Dim 1
//     savings %.
//   - `wireBytes`    — full JSON-RPC line including envelope. Useful as a
//     transport-cost reference; not the headline number.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface PendingCall {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  startNs: bigint;
  timer: NodeJS.Timeout | null;
}

export interface ToolCallResult {
  result: any;
  isError: boolean;
  errorText?: string;
  ms: number;
  /** UTF-8 bytes across content[*].text — what enters the model context. */
  payloadBytes: number;
  /** Full JSON-RPC response line UTF-8 length — transport cost. */
  wireBytes: number;
  /** Back-compat alias for payloadBytes — most callers use `bytes`. */
  bytes: number;
}

export interface McpStdioClientOptions {
  env?: Record<string, string>;
  /** Per-call RPC timeout in ms (default 30_000). */
  callTimeoutMs?: number;
}

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private initialized = false;
  private closed = false;
  private callTimeoutMs: number;

  constructor(serverPath: string, opts: McpStdioClientOptions | Record<string, string> = {}) {
    const optsObj: McpStdioClientOptions = "env" in opts || "callTimeoutMs" in opts
      ? (opts as McpStdioClientOptions)
      : { env: opts as Record<string, string> };
    this.callTimeoutMs = optsObj.callTimeoutMs ?? 30_000;
    this.proc = spawn(process.execPath, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(optsObj.env || {}), MCP_NO_COLOR: "1" },
    });
    this.proc.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.proc.stderr.on("data", () => { /* swallow — fork prints warnings */ });
    this.proc.on("exit", (code) => {
      this.closed = true;
      for (const p of this.pending.values()) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(new Error(`server exited with code ${code} before responding`));
      }
      this.pending.clear();
    });
  }

  private onStdout(chunk: Buffer) {
    this.buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }
      if (typeof msg?.id !== "number") continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      const ms = Number(process.hrtime.bigint() - p.startNs) / 1e6;
      if (msg.error) p.reject(new Error(msg.error.message || "rpc error"));
      else p.resolve({
        result: msg.result,
        ms,
        wireBytes: Buffer.byteLength(line, "utf8"),
      });
    }
  }

  private send(method: string, params?: unknown): Promise<{ result: any; ms: number; wireBytes: number }> {
    if (this.closed) return Promise.reject(new Error("client closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout after ${this.callTimeoutMs}ms (${method})`));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, startNs: process.hrtime.bigint(), timer });
      this.proc.stdin.write(payload + "\n");
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "compare-runner", version: "0.0.1" },
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    this.initialized = true;
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    if (!this.initialized) await this.initialize();
    const raw = await this.send("tools/call", { name, arguments: args });
    const payloadBytes = countPayloadBytes(raw.result);
    const isError = raw.result?.isError === true;
    return {
      result: raw.result,
      isError,
      ...(isError ? { errorText: extractToolText(raw.result) || "tool returned isError: true" } : {}),
      ms: raw.ms,
      payloadBytes,
      wireBytes: raw.wireBytes,
      bytes: payloadBytes,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    try { this.proc.stdin.end(); } catch {}
    try { this.proc.kill(); } catch {}
  }
}

export function countPayloadBytes(result: any): number {
  const content = result?.content;
  if (!Array.isArray(content)) {
    return Buffer.byteLength(JSON.stringify(result ?? null), "utf8");
  }
  let total = 0;
  for (const c of content) {
    if (typeof c?.text === "string") total += Buffer.byteLength(c.text, "utf8");
    else total += Buffer.byteLength(JSON.stringify(c), "utf8");
  }
  return total;
}

export function extractToolText(result: any): string {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => typeof c?.text === "string" ? c.text : "")
    .filter(Boolean)
    .join("\n");
}

// withClients / withForkOnly live in lib.ts where the server-path constants
// live. Keep runner.ts purely transport-layer.
