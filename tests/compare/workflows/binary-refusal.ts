// Tier 2: ctx_read on a binary blob. Fork should refuse gracefully with a
// short error, not dump bytes.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let binPath: string | null = null;
let tmpDir: string | null = null;

const wf: Workflow = {
  name: "binary-refusal",
  description: "Try ctx_read on a binary (gzip-magic) blob. Fork should refuse or summarize, not dump raw bytes.",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-bin");
    mkdirSync(tmpDir, { recursive: true });
    binPath = join(tmpDir, "blob.gz");
    // Write a small binary blob: gzip magic + random bytes.
    const buf = Buffer.alloc(2048);
    buf[0] = 0x1f; buf[1] = 0x8b; buf[2] = 0x08; buf[3] = 0x00;
    for (let i = 4; i < buf.length; i++) buf[i] = (i * 7 + 3) & 0xff;
    writeFileSync(binPath, buf);
    this.steps = [
      {
        label: "map-binary",
        tool: "ctx_read",
        args: { path: binPath, mode: "map" },
        allowError: true,
        assert: (text) => /binary|non.text|cannot|refuse|skip|unsupported/i.test(text) || text.length < 500,
      },
      {
        label: "slice-binary",
        tool: "ctx_read",
        args: { path: binPath, mode: "slice", compact: true, start: 1, end: 20 },
        allowError: true,
        assert: (text) => /binary|non.text|cannot|refuse|skip|unsupported/i.test(text) || text.length < 500,
      },
    ];
  },
  async afterAll() {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } tmpDir = null; binPath = null; }
  },
  steps: [],
};

export default wf;
