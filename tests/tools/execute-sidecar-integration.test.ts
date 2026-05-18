import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

interface JsonRpcResponse {
  id?: number;
  result?: {
    content?: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  };
  error?: unknown;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(__dirname, "..", "..", "build", "server.js");
const processes: ChildProcess[] = [];

function sendRpc(proc: ChildProcess, msg: Record<string, unknown>): void {
  proc.stdin!.write(`${JSON.stringify(msg)}\n`);
}

function waitForRpc(proc: ChildProcess, id: number, timeoutMs = 20_000): Promise<JsonRpcResponse | undefined> {
  return new Promise((resolveResponse) => {
    let buffer = "";
    const onData = (d: Buffer) => {
      buffer += d.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === id) {
            proc.stdout!.off("data", onData);
            clearTimeout(timer);
            resolveResponse(parsed);
            return;
          }
        } catch {
          // Ignore logs/non-RPC output.
        }
      }
    };
    const timer = setTimeout(() => {
      proc.stdout!.off("data", onData);
      resolveResponse(undefined);
    }, timeoutMs);
    proc.stdout!.on("data", onData);
  });
}

async function callTool(proc: ChildProcess, id: number, name: string, args: Record<string, unknown>): Promise<JsonRpcResponse | undefined> {
  const response = waitForRpc(proc, id);
  sendRpc(proc, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return response;
}

describe("ctx_execute sidecar integration", () => {
  afterEach(() => {
    for (const proc of processes.splice(0)) {
      try { proc.kill("SIGTERM"); } catch { /* best effort */ }
    }
  });

  it("saves redacted raw sidecar for intent-indexed output and fetches it by run id", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-execute-sidecar-"));
    try {
      const proc = spawn("node", [serverEntry], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
          CONTEXT_MODE_PROJECT_DIR: projectDir,
          CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
        },
      });
      processes.push(proc);

      const init = waitForRpc(proc, 1);
      sendRpc(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sidecar-test", version: "1.0" } },
      });
      expect((await init)?.error).toBeUndefined();
      sendRpc(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

      const execute = await callTool(proc, 2, "ctx_execute", {
        language: "javascript",
        intent: "needle line 699",
        code: [
          "for (let i = 0; i < 700; i++) {",
          "  console.log(`needle line ${i} TOKEN=abc123`);",
          "}",
        ].join("\n"),
      });
      const executeText = execute?.result?.content?.[0]?.text ?? "";
      expect(execute?.error).toBeUndefined();
      expect(executeText).toContain("Full redacted output saved:");
      expect(executeText).not.toContain("TOKEN=abc123");
      const runId = executeText.match(/runId: "([^"]+)"/)?.[1];
      expect(runId).toBeTruthy();

      const fetchRun = await callTool(proc, 3, "ctx_fetch_run", {
        runId,
        raw: true,
        maxBytes: 30_000,
      });
      const rawText = fetchRun?.result?.content?.[0]?.text ?? "";
      expect(fetchRun?.error).toBeUndefined();
      expect(rawText).toContain("needle line 699 TOKEN=<redacted>");
      expect(rawText).not.toContain("TOKEN=abc123");

      const search = await callTool(proc, 4, "ctx_search", {
        queries: ["abc123"],
      });
      const searchText = search?.result?.content?.[0]?.text ?? "";
      expect(search?.error).toBeUndefined();
      expect(searchText).not.toContain("TOKEN=abc123");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns explicit parser summaries and fails open for unknown parsers", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-execute-parser-"));
    try {
      const proc = spawn("node", [serverEntry], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
          CONTEXT_MODE_PROJECT_DIR: projectDir,
          CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
        },
      });
      processes.push(proc);

      const init = waitForRpc(proc, 10);
      sendRpc(proc, {
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "parser-test", version: "1.0" } },
      });
      expect((await init)?.error).toBeUndefined();
      sendRpc(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

      const parsed = await callTool(proc, 11, "ctx_execute", {
        language: "javascript",
        parser: "generic-failure",
        code: [
          "console.log('src/parser.test.ts:42 expected active received pending');",
          "console.error('Error: failed assertion');",
          "process.exitCode = 1;",
        ].join("\n"),
      });
      const parsedText = parsed?.result?.content?.[0]?.text ?? "";
      expect(parsed?.error).toBeUndefined();
      expect(parsed?.result?.isError).toBe(true);
      expect(parsedText).toContain("FAILED 2 failure line(s), exit 1");
      expect(parsedText).toContain("parser: generic-failure");
      expect(parsedText).toContain("src/parser.test.ts:42");
      expect(parsedText).toContain("Full redacted output saved:");

      const unknown = await callTool(proc, 12, "ctx_execute", {
        language: "javascript",
        parser: "missing-parser",
        code: "console.log('raw fallback stays visible')",
      });
      const unknownText = unknown?.result?.content?.[0]?.text ?? "";
      expect(unknown?.error).toBeUndefined();
      expect(unknownText).not.toContain("raw fallback stays visible");
      expect(unknownText).toContain("Output kept out of context");
      expect(unknownText).toContain("Parser diagnostic: parser not found: missing-parser");
      expect(unknownText).toContain("Full redacted output saved:");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("redacts secrets before returning small stdout to chat", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "context-mode-execute-redact-"));
    try {
      const proc = spawn("node", [serverEntry], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
          CONTEXT_MODE_PROJECT_DIR: projectDir,
          CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
        },
      });
      processes.push(proc);

      const init = waitForRpc(proc, 20);
      sendRpc(proc, {
        jsonrpc: "2.0",
        id: 20,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "redact-test", version: "1.0" } },
      });
      expect((await init)?.error).toBeUndefined();
      sendRpc(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

      const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
      const execute = await callTool(proc, 21, "ctx_execute", {
        language: "javascript",
        code: `console.log("OPENAI_API_KEY=${secret}")`,
      });
      const text = execute?.result?.content?.[0]?.text ?? "";
      expect(execute?.error).toBeUndefined();
      expect(text).toContain("OPENAI_API_KEY=<redacted>");
      expect(text).not.toContain(secret);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }, 30_000);
});
