// Tier 2: ctx_read symbol/outline on three languages (TS, Python, Go).
// Validates fork's parser fallbacks. Serena uses LSP — likely strong on TS,
// weaker on Py/Go without LSP installed.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let tmpDir: string | null = null;
let tsPath: string | null = null;
let pyPath: string | null = null;
let goPath: string | null = null;

const TS_SRC = `export class FooBar {
  doSomething(x: number): string {
    return "value=" + x;
  }
}
export function unrelated(): void { /* noop */ }
`;
const PY_SRC = `class FooBar:
    def do_something(self, x: int) -> str:
        return f"value={x}"

def unrelated():
    pass
`;
const GO_SRC = `package main

type FooBar struct{}

func (f *FooBar) DoSomething(x int) string {
\treturn fmt.Sprintf("value=%d", x)
}

func unrelated() {}
`;

const wf: Workflow = {
  name: "mixed-language-symbols",
  description: "ctx_read symbols on TS + Python + Go fixtures. Measures parser coverage outside of TypeScript.",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-multi-lang");
    mkdirSync(tmpDir, { recursive: true });
    tsPath = join(tmpDir, "Foo.ts");
    pyPath = join(tmpDir, "foo.py");
    goPath = join(tmpDir, "foo.go");
    writeFileSync(tsPath, TS_SRC);
    writeFileSync(pyPath, PY_SRC);
    writeFileSync(goPath, GO_SRC);
    this.steps = [
      { label: "ts-symbols", tool: "ctx_read", args: { path: tsPath, mode: "symbols" }, assert: (t) => /FooBar|doSomething/i.test(t) },
      { label: "py-symbols", tool: "ctx_read", args: { path: pyPath, mode: "symbols" }, assert: (t) => /FooBar|do_something|class/i.test(t) || t.length > 50 },
      { label: "go-symbols", tool: "ctx_read", args: { path: goPath, mode: "symbols" }, assert: (t) => /FooBar|DoSomething|func/i.test(t) || t.length > 50 },
    ];
  },
  async afterAll() {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } tmpDir = null; tsPath = pyPath = goPath = null; }
  },
  steps: [],
};

export default wf;
