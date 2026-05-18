import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SessionDB } from "../../src/session/db.js";

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

function runWriter(dbPath: string, writerId: number): Promise<void> {
  const code = `
    import { SessionDB } from "./src/session/db.ts";
    const db = new SessionDB({ dbPath: process.env.DB_PATH });
    const sessionId = "multi-process-session";
    db.ensureSession(sessionId, "/repo");
    for (let i = 0; i < 25; i++) {
      db.insertEvent(sessionId, {
        type: "tool",
        category: "test",
        priority: 2,
        data: JSON.stringify({ writerId: Number(process.env.WRITER_ID), i }),
      }, "PostToolUse");
    }
    db.close();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, "-e", code], {
      cwd: join(import.meta.dirname, "../.."),
      env: {
        ...process.env,
        DB_PATH: dbPath,
        WRITER_ID: String(writerId),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`writer ${writerId} exited ${code}: ${stderr}`));
    });
  });
}

describe("SessionDB multi-process concurrency", () => {
  it("handles concurrent analytics writes from separate processes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "context-mode-sessiondb-mp-"));
    const dbPath = join(dir, "session.db");
    try {
      await Promise.all(Array.from({ length: 6 }, (_, writerId) => runWriter(dbPath, writerId)));

      const db = new SessionDB({ dbPath });
      try {
        const events = db.getEvents("multi-process-session", { limit: 200 });
        expect(events).toHaveLength(150);
        expect(new Set(events.map((event) => JSON.parse(event.data).writerId))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
      } finally {
        db.close();
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Windows can hold SQLite sidecars briefly after child-process exit.
      }
    }
  }, 30_000);
});
