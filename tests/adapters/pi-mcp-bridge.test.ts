import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "ctx-pi-bridge-"));
});

afterEach(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // best effort
  }
  delete process.env.CONTEXT_MODE_BRIDGE_DEPTH;
});

describe("bootstrapMCPTools", () => {
  it("registers Pi renderers for bridged context-mode tools", async () => {
    const fakePath = join(scratch, "one-tool-server.mjs");
    writeFileSync(
      fakePath,
      `
      let line = "";
      process.stdin.on("data", (chunk) => {
        line += chunk.toString("utf-8");
        let idx;
        while ((idx = line.indexOf("\\n")) >= 0) {
          const raw = line.slice(0, idx).trim();
          line = line.slice(idx + 1);
          if (!raw) continue;
          let msg;
          try { msg = JSON.parse(raw); } catch { continue; }
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }) + "\\n");
          } else if (msg.method === "tools/list") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "ctx_stats", description: "stats", inputSchema: { type: "object" } }] } }) + "\\n");
          } else if (msg.method === "tools/call") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "session tokens saved" }] } }) + "\\n");
          }
        }
      });
      setInterval(() => {}, 60000);
      `,
      "utf-8",
    );

    const { bootstrapMCPTools } = await import("../../src/adapters/pi/mcp-bridge.js");
    const fakePi = { registerTool: vi.fn() };
    const handle = await bootstrapMCPTools(fakePi, fakePath);

    expect(handle.tools).toEqual(["ctx_stats"]);
    const registered = fakePi.registerTool.mock.calls[0][0];
    expect(typeof registered.renderCall).toBe("function");
    expect(typeof registered.renderResult).toBe("function");

    const theme = {
      bold: (text: string) => `**${text}**`,
      fg: (_color: string, text: string) => text,
    };
    const context: Record<string, unknown> = {};
    const callComponent = registered.renderCall({}, theme, context);
    expect(callComponent.render(80)).toEqual(["**ctx_stats**"]);

    const resultComponent = registered.renderResult(
      { content: [{ type: "text", text: "session tokens saved\nsecond line" }] },
      { expanded: false, isPartial: false },
      theme,
      {},
    );
    expect(resultComponent.render(80)).toEqual(["session tokens saved"]);

    handle.shutdown();
  }, 15_000);
});

describe("MCPStdioClient", () => {
  it("respawns for listTools after idle exit, not only callTool", async () => {
    const markerPath = join(scratch, "first-list-marker");
    const fakePath = join(scratch, "exit-after-list.mjs");
    writeFileSync(
      fakePath,
      `
      import { existsSync, writeFileSync } from "node:fs";
      const MARKER = ${JSON.stringify(markerPath)};
      const isFirst = !existsSync(MARKER);
      let line = "";
      let listCount = 0;
      process.stdin.on("data", (chunk) => {
        line += chunk.toString("utf-8");
        let idx;
        while ((idx = line.indexOf("\\n")) >= 0) {
          const raw = line.slice(0, idx).trim();
          line = line.slice(idx + 1);
          if (!raw) continue;
          let msg;
          try { msg = JSON.parse(raw); } catch { continue; }
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }) + "\\n");
          } else if (msg.method === "tools/list") {
            listCount++;
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "ping-pid-" + process.pid, description: "p", inputSchema: { type: "object" } }] } }) + "\\n");
            if (isFirst && listCount === 1) {
              writeFileSync(MARKER, "1");
              setTimeout(() => process.exit(0), 10);
            }
          }
        }
      });
      setInterval(() => {}, 60000);
      `,
      "utf-8",
    );

    const { MCPStdioClient } = await import("../../src/adapters/pi/mcp-bridge.js");
    const client = new MCPStdioClient(fakePath);
    client.start();
    await client.initialize();

    const tools1 = await client.listTools();
    const pid1 = tools1[0].name.replace(/^ping-pid-/, "");

    await new Promise<void>((resolve) => {
      const wait = () => {
        if ((client as unknown as { exited: boolean }).exited) return resolve();
        setTimeout(wait, 25);
      };
      wait();
    });

    const tools2 = await client.listTools();
    const pid2 = tools2[0].name.replace(/^ping-pid-/, "");
    expect(pid2).not.toBe(pid1);

    client.shutdown();
  }, 15_000);
});
