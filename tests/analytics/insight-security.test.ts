import { afterEach, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SOURCE_SERVER = resolve(ROOT, "insight", "server.mjs");

const children: ChildProcess[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  const exits: Array<Promise<void>> = [];
  for (const child of children.splice(0)) {
    exits.push(new Promise((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveExit();
        return;
      }
      child.once("exit", () => resolveExit());
      try { child.kill("SIGTERM"); } catch { resolveExit(); }
      setTimeout(resolveExit, 1000).unref();
    }));
  }
  await Promise.allSettled(exits);
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function httpGet(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          resolveRequest({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", rejectRequest);
    req.end();
  });
}

function hasBunCommand(): boolean {
  try {
    return spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createHttpServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else rejectPort(new Error("Could not allocate test port"));
      });
    });
  });
}

async function startInsight(runtime: "node" | "bun" = "node"): Promise<{ port: number; child: ChildProcess }> {
  const tempRoot = mkdtempSync(join(tmpdir(), "ctx-insight-security-"));
  tempDirs.push(tempRoot);

  const tempInsightDir = join(tempRoot, "insight");
  mkdirSync(join(tempInsightDir, "dist"), { recursive: true });
  mkdirSync(join(tempRoot, "sessions"), { recursive: true });
  mkdirSync(join(tempRoot, "content"), { recursive: true });
  copyFileSync(SOURCE_SERVER, join(tempInsightDir, "server.mjs"));
  writeFileSync(join(tempInsightDir, "dist", "index.html"), "<!doctype html><html><body>stub</body></html>");
  symlinkSync(resolve(ROOT, "node_modules"), join(tempRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");

  const port = await getFreePort();
  const command = runtime === "bun" ? "bun" : process.execPath;
  const child = spawn(command, [join(tempInsightDir, "server.mjs")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      INSIGHT_SESSION_DIR: join(tempRoot, "sessions"),
      INSIGHT_CONTENT_DIR: join(tempRoot, "content"),
    },
  });
  children.push(child);
  return { port, child };
}

async function waitForInsight(port: number, child: ChildProcess): Promise<void> {
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  let exited = false;
  child.on("exit", () => { exited = true; });

  for (let i = 0; i < 80; i++) {
    if (exited) throw new Error(`Insight server exited before readiness. stderr: ${stderr || "(empty)"}`);
    try {
      const res = await httpGet(port, "/");
      if (res.status === 200) return;
    } catch {
      // Keep polling until the server accepts connections.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Insight server did not become ready. stderr: ${stderr || "(empty)"}`);
}

test("Insight API rejects disallowed Origin and Host before returning local data", async () => {
  const { port, child } = await startInsight();
  await waitForInsight(port, child);

  const allowed = await httpGet(port, "/api/overview", { Host: `127.0.0.1:${port}` });
  expect(allowed.status).toBe(200);
  expect(allowed.headers["cache-control"]).toBe("no-store");
  expect(allowed.headers["x-content-type-options"]).toBe("nosniff");

  const badOrigin = await httpGet(port, "/api/overview", {
    Host: `127.0.0.1:${port}`,
    Origin: "http://127.0.0.1:8081",
  });
  expect(badOrigin.status).toBe(403);
  expect(badOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  expect(JSON.parse(badOrigin.body).error).toBe("origin not allowed");

  const badHost = await httpGet(port, "/api/overview", { Host: `evil.test:${port}` });
  expect(badHost.status).toBe(403);
  expect(badHost.headers["access-control-allow-origin"]).toBeUndefined();
  expect(JSON.parse(badHost.body).error).toBe("host not allowed");
});

test.runIf(hasBunCommand())("Insight API guard also applies under Bun", async () => {
  const { port, child } = await startInsight("bun");
  await waitForInsight(port, child);

  const badOrigin = await httpGet(port, "/api/overview", {
    Host: `127.0.0.1:${port}`,
    Origin: "http://127.0.0.1:8081",
  });
  expect(badOrigin.status).toBe(403);
  expect(badOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  expect(JSON.parse(badOrigin.body).error).toBe("origin not allowed");
});
