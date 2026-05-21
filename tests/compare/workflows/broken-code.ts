// Workflow: read a syntactically broken file. Symbol tools may fail; ctx_read
// map/slice should still produce useful output.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let brokenPath: string | null = null;
let tmpDir: string | null = null;

const BROKEN_SOURCE = `// Deliberately broken TypeScript-ish source.
export class Half {
  constructor(public x: number {  // missing closing paren on parameter
    this.x = x
  }

  greet(name: string  // missing closing paren
    return "hi " + name
  }
}

const stray = (
function unfinished(

interface Lonely {
  field: stringNoSemiNoBrace

// Trailing junk to confuse parsers further.
@@@ !!! ###
`;

const wf: Workflow = {
  name: "broken-code",
  description: "Read a deliberately broken source file via ctx_read map + slice. Validates that bounded reads still work when symbol providers fail.",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-broken");
    brokenPath = join(tmpDir, "broken.ts");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(brokenPath, BROKEN_SOURCE, "utf8");
    this.steps = [
      { label: "map",     tool: "ctx_read", args: { path: brokenPath, mode: "map" },                          assert: (t) => t.length > 0 },
      { label: "outline", tool: "ctx_read", args: { path: brokenPath, mode: "outline" },                      assert: (t) => t.length > 0 },
      { label: "slice",   tool: "ctx_read", args: { path: brokenPath, mode: "slice", compact: true, start: 1, end: 30 },     assert: (t) => /class|Half|interface|broken|stray/i.test(t) || t.length > 50 },
    ];
  },
  async afterAll() {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      tmpDir = null;
      brokenPath = null;
    }
  },
  steps: [],
};

export default wf;
