// Phase 1.5 — Failing build. Non-zero exit, error output. Tests whether tools
// compress error output equally well (or pass through raw on failure).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CompetitorWorkflow } from "./types.js";

let tmpDir: string | null = null;
let badPath = "";

const BAD_TS = `
// Deliberately broken TypeScript-ish code
export class Half {
  constructor(public x: number {  // missing closing paren
    this.x = x
  }
  doSomething(): number {
    return undeclaredVariable + this.x;
  }
}
const value: string = 42;        // wrong type
const arr: number[] = "not array";
function badReturn(): number { return "string"; }
`;

const wf: CompetitorWorkflow = {
  name: "failing-build",
  description: "Trigger a TypeScript compilation error. Tests error-output compression.",
  fallbackPolicy: "raw-on-error",
  async beforeAll() {
    tmpDir = join(tmpdir(), `competitor-fail-${process.pid}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    badPath = join(tmpDir, "broken.ts");
    writeFileSync(badPath, BAD_TS);
    (this.steps as any) = [
      {
        kind: "command",
        label: "tsc-fail",
        command: `npx -y typescript@5 tsc --noEmit --target es2020 --module esnext --moduleResolution bundler ${JSON.stringify(badPath)}`,
        timeoutMs: 90_000,
        assert: (t: string) => /error|Error|TS\d+|cannot|expected/i.test(t) || t.length > 50,
      },
      {
        kind: "command",
        label: "node-syntax-fail",
        command: `node --check ${JSON.stringify(badPath)}`,
        timeoutMs: 10_000,
        assert: (t: string) => /SyntaxError|error|expected/i.test(t) || t.length > 30,
      },
    ];
  },
  async afterAll() {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },
  steps: [],
};

export default wf;
