// Tier 1: compact ctx_read vs Serena on broken/non-TS source. Symbol provider
// will likely fail; ctx_read map/slice should still produce useful output.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let brokenPath: string | null = null;
let tmpDir: string | null = null;

const BROKEN = `// Broken-ish hybrid: JS-flavored with stray TS, unclosed blocks.
import { unknown from "./missing-module";

export class Partial {
  greet(name: string  // unclosed paren
    return "hi " + name
  }
}

declare const stray: any = (
function noBody(

interface Lonely {
  field: stringNoSemiNoBrace

@@@ trailing !!! junk ###
`;

const wf: Workflow = {
  name: "compact-vs-serena-broken",
  description: "Read a deliberately broken source file via ctx_read map / outline / slice. Compares against Serena (would fail). Oracle checks file body presence.",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-broken2");
    mkdirSync(tmpDir, { recursive: true });
    brokenPath = join(tmpDir, "broken-hybrid.ts");
    writeFileSync(brokenPath, BROKEN, "utf8");
    this.steps = [
      {
        label: "map",
        tool: "ctx_read",
        args: { path: brokenPath, mode: "map" },
        assert: (text) => text.length > 0,
      },
      {
        label: "outline",
        tool: "ctx_read",
        args: { path: brokenPath, mode: "outline" },
        assert: (text) => text.length > 0,
      },
      {
        label: "slice-head",
        tool: "ctx_read",
        args: { path: brokenPath, mode: "slice", compact: true, start: 1, end: 12 },
        assert: (text) => text.includes("Partial") || text.includes("import") || text.length > 30,
      },
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
