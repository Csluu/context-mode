import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanupStaleContentDBs } from "../../src/store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeContentDir(): string {
  const root = join(tmpdir(), `ctx-store-cleanup-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

describe("cleanupStaleContentDBs", () => {
  test("removes stale orphaned WAL/SHM sidecars when the main DB is gone", () => {
    const contentDir = makeContentDir();
    const wal = join(contentDir, "orphan.db-wal");
    const shm = join(contentDir, "orphan.db-shm");
    writeFileSync(wal, "wal");
    writeFileSync(shm, "shm");
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(wal, old, old);
    utimesSync(shm, old, old);

    const cleaned = cleanupStaleContentDBs(contentDir, 1);

    expect(cleaned).toBe(1);
    expect(existsSync(wal)).toBe(false);
    expect(existsSync(shm)).toBe(false);
  });

  test("keeps orphaned WAL/SHM sidecars that are still inside the retention window", () => {
    const contentDir = makeContentDir();
    const wal = join(contentDir, "fresh.db-wal");
    const shm = join(contentDir, "fresh.db-shm");
    writeFileSync(wal, "wal");
    writeFileSync(shm, "shm");

    const cleaned = cleanupStaleContentDBs(contentDir, 30);

    expect(cleaned).toBe(0);
    expect(existsSync(wal)).toBe(true);
    expect(existsSync(shm)).toBe(true);
  });
});
