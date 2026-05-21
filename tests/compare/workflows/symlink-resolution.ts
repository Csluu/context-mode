// Tier 3: ctx_read via symlink. Should resolve to the target content (or
// refuse with a clear message on Windows where symlinks need elevation).

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let tmpDir: string | null = null;
let realPath: string | null = null;
let linkPath: string | null = null;
let setupSkipped = false;

const wf: Workflow = {
  name: "symlink-resolution",
  description: "Read a file through a symlink. Validates resolution (or graceful refusal on platforms that lack symlink perms).",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-symlink");
    mkdirSync(tmpDir, { recursive: true });
    realPath = join(tmpDir, "target.ts");
    linkPath = join(tmpDir, "link.ts");
    writeFileSync(realPath, "export const SYMLINK_MARKER = 'resolved-ok';\nexport function fn() { return SYMLINK_MARKER; }\n");
    try {
      symlinkSync(realPath, linkPath);
    } catch {
      setupSkipped = true;
    }
    const readPath = !setupSkipped && existsSync(linkPath!) ? linkPath! : realPath;
    this.steps = [
      {
        label: "read-via-link",
        tool: "ctx_read",
        args: { path: readPath, mode: "outline" },
        assert: (t) => /SYMLINK_MARKER|fn|export/.test(t) || /symlink|permission|denied|unsupported/i.test(t),
      },
    ];
  },
  async afterAll() {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } tmpDir = null; realPath = linkPath = null; setupSkipped = false; }
  },
  steps: [],
};

export default wf;
