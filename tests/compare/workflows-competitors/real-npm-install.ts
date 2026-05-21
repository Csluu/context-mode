// Phase 1.5 — Real npm install (--dry-run, network-friendly). Tests handling
// of real-world dependency-resolution noise.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CompetitorWorkflow } from "./types.js";

let tmpDir: string | null = null;

const FIXTURE_PKG = JSON.stringify({
  name: "competitor-bench-fixture",
  version: "0.0.0",
  private: true,
  dependencies: {
    "lodash": "^4.17.21",
    "axios": "^1.6.0",
    "chalk": "^5.3.0",
    "yargs": "^17.7.0",
    "minimist": "^1.2.8",
  },
}, null, 2);

const wf: CompetitorWorkflow = {
  name: "real-npm-install",
  description: "npm install --dry-run on a 5-dep fixture. Real-world install spam.",
  fallbackPolicy: "raw-on-error",
  async beforeAll() {
    tmpDir = join(tmpdir(), `competitor-npm-${process.pid}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "package.json"), FIXTURE_PKG);
    (this.steps as any) = [
      {
        kind: "command",
        label: "npm-install-dry",
        command: `cd ${JSON.stringify(tmpDir)} && npm install --dry-run --no-fund --no-audit`,
        timeoutMs: 120_000,
        assert: (t: string) => /added|packages|lodash|axios|npm/i.test(t) || t.length > 30,
      },
      {
        kind: "command",
        label: "npm-ls-deps",
        command: `cd ${JSON.stringify(tmpDir)} && npm ls --all --depth=2 2>&1 | head -200`,
        timeoutMs: 30_000,
        assert: (t: string) => t.length > 0,
      },
    ];
  },
  async afterAll() {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },
  steps: [],
};

export default wf;
