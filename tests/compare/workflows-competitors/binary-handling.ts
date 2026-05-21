// Phase 1.5 — Binary handling. Read PNG-magic and gzip-magic blobs through
// each tool's read path. Tools that refuse/summarize win; tools that dump raw
// bytes lose.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CompetitorWorkflow } from "./types.js";

let tmpDir: string | null = null;
let pngPath = "";
let gzPath = "";

const wf: CompetitorWorkflow = {
  name: "binary-handling",
  description: "Read PNG / gzip blobs. Refusal / summary wins; raw byte dump loses.",
  fallbackPolicy: "raw-on-error",
  async beforeAll() {
    tmpDir = join(tmpdir(), `competitor-bin-${process.pid}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    pngPath = join(tmpDir, "blob.png");
    const pngBuf = Buffer.alloc(2048);
    // PNG magic
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => { pngBuf[i] = b; });
    for (let i = 8; i < pngBuf.length; i++) pngBuf[i] = (i * 11 + 7) & 0xff;
    writeFileSync(pngPath, pngBuf);
    gzPath = join(tmpDir, "blob.gz");
    const gz = Buffer.alloc(2048);
    [0x1f, 0x8b, 0x08, 0x00].forEach((b, i) => { gz[i] = b; });
    for (let i = 4; i < gz.length; i++) gz[i] = (i * 7 + 3) & 0xff;
    writeFileSync(gzPath, gz);
    (this.steps as any) = [
      { kind: "read", label: "read-png-magic", path: pngPath, mode: "map", assert: (t: string) => /binary|refuse|unsupported|cannot|skip/i.test(t) || t.length < 500 },
      { kind: "read", label: "read-gzip-magic", path: gzPath, mode: "map", assert: (t: string) => /binary|refuse|unsupported|cannot|skip/i.test(t) || t.length < 500 },
    ];
  },
  async afterAll() {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },
  steps: [],
};

export default wf;
