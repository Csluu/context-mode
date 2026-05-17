import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  getWorktreeSuffix,
  hashProjectDirCanonical,
  hashProjectDirLegacy,
  resolveSessionDbPath,
  SessionDB,
} from "../../src/session/db.js";
import { purgeSession } from "../../src/session/purge.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = join(tmpdir(), `ctx-purge-dry-run-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

describe("purgeSession dry-run", () => {
  test("previews project files without deleting them", () => {
    const root = makeRoot();
    const projectDir = join(root, "Project");
    const sessionsDir = join(root, "sessions");
    const contentDir = join(root, "content");
    const legacyContentDir = join(root, "legacy-content");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(contentDir, { recursive: true });
    mkdirSync(legacyContentDir, { recursive: true });

    const suffix = getWorktreeSuffix(projectDir);
    const canonicalHash = hashProjectDirCanonical(projectDir);
    const legacyHash = hashProjectDirLegacy(projectDir);
    const sessionBase = join(sessionsDir, `${canonicalHash}${suffix}`);
    const contentBase = join(contentDir, `${canonicalHash}.db`);
    const legacyContentBase = join(legacyContentDir, `${legacyHash}.db`);
    const files = [
      `${sessionBase}.db`,
      `${sessionBase}.db-wal`,
      `${sessionBase}-events.md`,
      `${sessionBase}.cleanup`,
      contentBase,
      `${contentBase}-wal`,
      legacyContentBase,
    ];
    for (const file of files) writeFileSync(file, "x");

    const result = purgeSession({
      projectDir,
      sessionsDir,
      contentDir,
      legacyContentDir,
      contentHash: legacyHash,
      scope: "project",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.deleted).toContain("knowledge base (FTS5)");
    expect(result.deleted).toContain("session events DB");
    expect(result.deleted).toContain("session events markdown");
    expect(result.wipedPaths.length).toBeGreaterThanOrEqual(files.length);
    for (const file of files) expect(existsSync(file)).toBe(true);
  });

  test("previews session rows without deleting them", () => {
    const root = makeRoot();
    const projectDir = join(root, "Project");
    const sessionsDir = join(root, "sessions");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });

    const sessionId = randomUUID();
    const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
    let db = new SessionDB({ dbPath });
    db.insertEvent(sessionId, {
      type: "tool_call",
      category: "tool",
      priority: 1,
      data: "dry-run event",
    });
    db.close();

    const result = purgeSession({
      projectDir,
      sessionsDir,
      sessionId,
      scope: "session",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.deleted).toContain(`session rows for ${sessionId}`);

    db = new SessionDB({ dbPath });
    try {
      expect(db.getEvents(sessionId)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
