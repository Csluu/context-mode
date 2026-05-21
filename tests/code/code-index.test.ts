import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CodeIndexService } from "../../src/code/service.js";
import { CodeIndexStore } from "../../src/code/index-store.js";
import { makeCtxCode } from "../../src/tools/code.js";
import type { ToolContext } from "../../src/tools/types.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "context-mode-code-index-"));
}

function cleanupProject(projectDir: string): void {
  try {
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // Windows can hold node:sqlite handles briefly after close. The temp dir
    // name is unique, and test correctness is asserted before cleanup.
  }
}

function makeStore(projectDir: string): CodeIndexStore {
  const dbDir = join(projectDir, ".context-mode");
  mkdirSync(dbDir, { recursive: true });
  return new CodeIndexStore(join(dbDir, "code-index.db"), { retryDelays: [0, 0, 0] });
}

function testContext(sessionDir: string): ToolContext {
  return {
    server: {} as ToolContext["server"],
    pluginRoot: sessionDir,
    getSessionDir: () => sessionDir,
    trackResponse: (_tool, response) => response,
  };
}

describe("CodeIndexService", () => {
  it("indexes TypeScript symbols and reads an exact symbol slice", () => {
    const projectDir = tempProject();
    let store: CodeIndexStore | null = null;
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(join(projectDir, "src", "app.ts"), [
        "import { readFileSync } from 'node:fs';",
        "export interface Props { enabled: boolean }",
        "export class Widget {",
        "  render(): string {",
        "    return readFileSync('x', 'utf8');",
        "  }",
        "}",
        "export const useWidget = () => new Widget();",
      ].join("\n"), "utf8");

      store = makeStore(projectDir);
      const service = new CodeIndexService({ projectDir, store });
      const found = service.findSymbols("Widget", { limit: 10 });

      expect(found.freshness.checked).toBe(1);
      expect(found.freshness.parsed).toBe(1);
      expect(found.matches.some((match) => match.kind === "class" && match.filePath === "src/app.ts")).toBe(true);

      const read = service.readSymbol("Widget", { file: "src/app.ts" });

      expect(read.status).toBe("ok");
      expect(read.text).toContain("ctx_code read_symbol: Widget");
      expect(read.text).toContain("export class Widget");
      expect(read.text).toContain("render(): string");
    } finally {
      try { store?.cleanup(); } catch { /* ignore */ }
      cleanupProject(projectDir);
    }
  });

  it("records denied files outside the normal file/symbol rows", () => {
    const projectDir = tempProject();
    let store: CodeIndexStore | null = null;
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(join(projectDir, "src", "public.ts"), "export const visible = true;\n", "utf8");
      writeFileSync(join(projectDir, "src", "secret.ts"), "export const hidden = true;\n", "utf8");

      store = makeStore(projectDir);
      const service = new CodeIndexService({
        projectDir,
        store,
        policy: {
          checkFilePath: (filePath) => filePath.endsWith("secret.ts") ? "blocked test file" : null,
        },
      });

      const found = service.findSymbols("hidden", { limit: 10 });
      const visible = service.findSymbols("visible", { limit: 10 });

      expect(found.freshness.denied).toBe(1);
      expect(found.matches).toHaveLength(0);
      expect(visible.matches).toHaveLength(1);
    } finally {
      try { store?.cleanup(); } catch { /* ignore */ }
      cleanupProject(projectDir);
    }
  });

  it("clears stale symbols when an indexed file later becomes denied", () => {
    const projectDir = tempProject();
    let store: CodeIndexStore | null = null;
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(join(projectDir, "src", "secret.ts"), "export const hidden = true;\n", "utf8");

      store = makeStore(projectDir);
      const allowed = new CodeIndexService({ projectDir, store });
      expect(allowed.findSymbols("hidden", { limit: 10 }).matches).toHaveLength(1);

      const denied = new CodeIndexService({
        projectDir,
        store,
        policy: {
          checkFilePath: (filePath) => filePath.endsWith("secret.ts") ? "blocked test file" : null,
        },
      });

      const found = denied.findSymbols("hidden", { limit: 10 });

      expect(found.freshness.denied).toBe(1);
      expect(found.matches).toHaveLength(0);
    } finally {
      try { store?.cleanup(); } catch { /* ignore */ }
      cleanupProject(projectDir);
    }
  });


  it("indexes Rust symbols and method ranges without a language server", () => {
    const projectDir = tempProject();
    let store: CodeIndexStore | null = null;
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(join(projectDir, "src", "lib.rs"), [
        "pub struct Worker {",
        "    name: String,",
        "}",
        "",
        "impl Worker {",
        "    pub fn new(name: String) -> Self {",
        "        Self { name }",
        "    }",
        "",
        "    fn render(&self) -> String {",
        "        self.name.clone()",
        "    }",
        "}",
        "",
        "impl Runner for Worker",
        "{",
        "    fn run(&self) {",
        "    }",
        "}",
        "",
        "pub trait Runner {",
        "    fn run(&self);",
        "}",
        "",
        "pub fn build_worker(name: String) -> Worker {",
        "    Worker::new(name)",
        "}",
      ].join("\n"), "utf8");

      store = makeStore(projectDir);
      const service = new CodeIndexService({ projectDir, store });

      const outline = service.fileOutline("src/lib.rs");
      expect(outline.symbols.some((symbol) => symbol.kind === "struct" && symbol.name === "Worker")).toBe(true);
      expect(outline.symbols.some((symbol) => symbol.kind === "trait" && symbol.name === "Runner")).toBe(true);
      expect(outline.symbols.some((symbol) => symbol.kind === "method" && symbol.qualifiedName === "Worker.new")).toBe(true);
      expect(outline.symbols.some((symbol) => symbol.kind === "method" && symbol.qualifiedName === "Worker.run")).toBe(true);

      const read = service.readSymbol("Worker.new", { file: "src/lib.rs", kind: "method" });
      expect(read.status).toBe("ok");
      expect(read.text).toContain("pub fn new");
      expect(read.text).toContain("Self { name }");
    } finally {
      try { store?.cleanup(); } catch { /* ignore */ }
      cleanupProject(projectDir);
    }
  });

  it("builds Rust mod relationships and likely tests without a language server", () => {
    const projectDir = tempProject();
    let store: CodeIndexStore | null = null;
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      mkdirSync(join(projectDir, "tests"), { recursive: true });
      writeFileSync(join(projectDir, "src", "lib.rs"), [
        "pub mod worker;",
        "pub use worker::{build_worker, Worker};",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "src", "worker.rs"), [
        "pub struct Worker {",
        "    name: String,",
        "}",
        "",
        "impl Worker {",
        "    pub fn new(name: String) -> Self {",
        "        Self { name }",
        "    }",
        "}",
        "",
        "pub fn build_worker(name: String) -> Worker {",
        "    Worker::new(name)",
        "}",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "tests", "worker_test.rs"), [
        "use crate::worker::build_worker;",
        "fn test_worker() {",
        "    build_worker(\"alpha\".to_string());",
        "}",
      ].join("\n"), "utf8");

      store = makeStore(projectDir);
      const service = new CodeIndexService({ projectDir, store });
      const libRelated = service.relatedFiles("src/lib.rs");
      const workerRelated = service.relatedFiles("src/worker.rs");

      expect(libRelated.importedFiles).toContain("src/worker.rs");
      expect(workerRelated.importers.some((imp) => imp.filePath === "src/lib.rs" && imp.kind === "rust-mod")).toBe(true);
      expect(workerRelated.likelyTests).toContain("tests/worker_test.rs");
    } finally {
      try { store?.cleanup(); } catch { /* ignore */ }
      cleanupProject(projectDir);
    }
  });

  it("refreshes changed files and drops deleted-file symbols", () => {
    const projectDir = tempProject();
    let store: CodeIndexStore | null = null;
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      const filePath = join(projectDir, "src", "stale.ts");
      writeFileSync(filePath, "export function oldSymbol() { return 1; }\n", "utf8");

      store = makeStore(projectDir);
      const service = new CodeIndexService({ projectDir, store });

      expect(service.findSymbols("oldSymbol").matches).toHaveLength(1);

      writeFileSync(filePath, "export function renamedSymbol() {\n  return 12345;\n}\n", "utf8");

      expect(service.findSymbols("oldSymbol").matches).toHaveLength(0);
      expect(service.findSymbols("renamedSymbol").matches).toHaveLength(1);

      unlinkSync(filePath);
      service.ensureProjectIndexed();

      expect(service.findSymbols("renamedSymbol").matches).toHaveLength(0);
    } finally {
      try { store?.cleanup(); } catch { /* ignore */ }
      cleanupProject(projectDir);
    }
  });

  it("builds a persisted import graph with re-exports and likely tests", () => {
    const projectDir = tempProject();
    let store: CodeIndexStore | null = null;
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      mkdirSync(join(projectDir, "tests"), { recursive: true });
      writeFileSync(join(projectDir, "src", "widget.ts"), [
        "import { helper } from './helper';",
        "export function buildWidget(name: string): string {",
        "  return helper(name);",
        "}",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "src", "helper.ts"), "export const helper = (value: string) => value;\n", "utf8");
      writeFileSync(join(projectDir, "src", "index.ts"), "export { buildWidget } from './widget';\n", "utf8");
      writeFileSync(join(projectDir, "src", "use-widget.ts"), [
        "import { buildWidget } from './widget';",
        "export const rendered = buildWidget('alpha');",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "tests", "widget.test.ts"), [
        "import { buildWidget } from '../src/widget';",
        "buildWidget('test');",
      ].join("\n"), "utf8");

      store = makeStore(projectDir);
      const service = new CodeIndexService({ projectDir, store });
      const related = service.relatedFiles("src/widget.ts");

      expect(related.importedFiles).toContain("src/helper.ts");
      expect(related.importers.some((imp) => imp.filePath === "src/index.ts" && imp.kind === "re-export")).toBe(true);
      expect(related.importers.some((imp) => imp.filePath === "src/use-widget.ts")).toBe(true);
      expect(related.importers.some((imp) => imp.filePath === "tests/widget.test.ts")).toBe(true);
      expect(related.likelyTests).toContain("tests/widget.test.ts");
    } finally {
      try { store?.cleanup(); } catch { /* ignore */ }
      cleanupProject(projectDir);
    }
  });
});

describe("ctx_code tool", () => {
  it("returns compact symbol lookup and symbol body output", async () => {
    const projectDir = tempProject();
    const sessionDir = join(projectDir, ".context-mode", "sessions");
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(projectDir, "src", "app.ts"), [
        "export function buildWidget(name: string): string {",
        "  return `widget:${name}`;",
        "}",
      ].join("\n"), "utf8");
      const tool = makeCtxCode({ getProjectDir: () => projectDir });

      const found = await tool.handler({ action: "find_symbol", query: "buildWidget", compact: true }, testContext(sessionDir));
      expect(found.isError).toBeUndefined();
      expect(found.content[0].text).toContain("ctx_code find_symbol buildWidget");
      expect(found.content[0].text).toContain("src/app.ts:1-3 function buildWidget");

      const read = await tool.handler({ action: "read_symbol", query: "buildWidget", file: "src/app.ts" }, testContext(sessionDir));
      expect(read.isError).toBeUndefined();
      expect(read.content[0].text).toContain("ctx_code read_symbol: buildWidget");
      expect(read.content[0].text).toContain("1: export function buildWidget");
    } finally {
      cleanupProject(projectDir);
    }
  });

  it("returns lightweight textual refs with confidence labels", async () => {
    const projectDir = tempProject();
    const sessionDir = join(projectDir, ".context-mode", "sessions");
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(projectDir, "src", "widget.ts"), [
        "export function buildWidget(name: string): string {",
        "  return `widget:${name}`;",
        "}",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "src", "use-widget.ts"), [
        "import { buildWidget } from './widget';",
        "export const rendered = buildWidget('alpha');",
        "// buildWidget is intentionally mentioned in a comment",
      ].join("\n"), "utf8");
      const tool = makeCtxCode({ getProjectDir: () => projectDir });

      const refs = await tool.handler({ action: "refs_light", symbol: "buildWidget", limit: 10 }, testContext(sessionDir));

      expect(refs.isError).toBeUndefined();
      expect(refs.content[0].text).toContain("ctx_code refs_light: buildWidget");
      expect(refs.content[0].text).toContain("definition: src/widget.ts:1-3 function buildWidget");
      expect(refs.content[0].text).toContain("src/use-widget.ts:1");
      expect(refs.content[0].text).toContain("src/use-widget.ts:2");
      expect(refs.content[0].text).toMatch(/(MEDIUM|LOW) src\/use-widget\.ts/);
      expect(refs.content[0].text).toContain("LOW src/use-widget.ts:3 comment textual match");
    } finally {
      cleanupProject(projectDir);
    }
  });

  it("reuses the persisted code index across separate tool calls", async () => {
    const projectDir = tempProject();
    const sessionDir = join(projectDir, ".context-mode", "sessions");
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(projectDir, "src", "cache.ts"), [
        "export function cachedSymbol(): number {",
        "  return 7;",
        "}",
      ].join("\n"), "utf8");
      const tool = makeCtxCode({ getProjectDir: () => projectDir });

      const first = await tool.handler({ action: "find_symbol", query: "cachedSymbol", compact: true }, testContext(sessionDir));
      const second = await tool.handler({ action: "find_symbol", query: "cachedSymbol", compact: true }, testContext(sessionDir));

      expect(first.isError).toBeUndefined();
      expect(second.isError).toBeUndefined();
      expect(first.content[0].text).toContain("freshness: c1 r0 p1 d0 s0");
      expect(second.content[0].text).toContain("freshness: c1 r1 p0 d0 s0");
    } finally {
      cleanupProject(projectDir);
    }
  });

  it("returns a bounded context pack with imports, importers, refs, and likely tests", async () => {
    const projectDir = tempProject();
    const sessionDir = join(projectDir, ".context-mode", "sessions");
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      mkdirSync(join(projectDir, "tests"), { recursive: true });
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(projectDir, "src", "widget.ts"), [
        "import { helper } from './helper';",
        "export function buildWidget(name: string): string {",
        "  return helper(name);",
        "}",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "src", "helper.ts"), [
        "export function helper(value: string): string {",
        "  return `helper:${value}`;",
        "}",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "src", "use-widget.ts"), [
        "import { buildWidget } from './widget';",
        "export const rendered = buildWidget('alpha');",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "src", "index.ts"), [
        "export { buildWidget } from './widget';",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "src", "secret-importer.ts"), [
        "import { buildWidget } from './widget';",
        "export const leaked = buildWidget('secret');",
      ].join("\n"), "utf8");
      writeFileSync(join(projectDir, "tests", "widget.test.ts"), [
        "import { buildWidget } from '../src/widget';",
        "buildWidget('test');",
      ].join("\n"), "utf8");
      const tool = makeCtxCode({
        getProjectDir: () => projectDir,
        checkFilePath: (filePath) => filePath.endsWith("secret-importer.ts") ? "blocked test file" : null,
      });

      const pack = await tool.handler({
        action: "pack",
        query: "buildWidget",
        file: "src/widget.ts",
        kind: "function",
        budgetBytes: 8192,
      }, testContext(sessionDir));

      expect(pack.isError).toBeUndefined();
      expect(pack.content[0].text).toContain("ctx_code pack: buildWidget");
      expect(pack.content[0].text).toContain("symbol_slice:");
      expect(pack.content[0].text).toContain("- helper from ./helper @1");
      expect(pack.content[0].text).toContain("- imports src/helper.ts");
      expect(pack.content[0].text).toContain("- imported by src/use-widget.ts:1");
      expect(pack.content[0].text).toContain("- imported by src/index.ts:1");
      expect(pack.content[0].text).not.toContain("secret-importer");
      expect(pack.content[0].text).toContain("- tests/widget.test.ts");
      expect(pack.content[0].text).toContain("refs_light:");
      expect(Buffer.byteLength(pack.content[0].text)).toBeLessThanOrEqual(8192);

      const jsonPack = await tool.handler({
        action: "pack",
        query: "buildWidget",
        file: "src/widget.ts",
        kind: "function",
        budgetBytes: 320,
        json: true,
      }, testContext(sessionDir));
      expect(() => JSON.parse(jsonPack.content[0].text)).not.toThrow();

      const related = await tool.handler({
        action: "related_files",
        file: "src/widget.ts",
        budgetBytes: 4096,
      }, testContext(sessionDir));
      expect(related.isError).toBeUndefined();
      expect(related.content[0].text).toContain("ctx_code related_files: src/widget.ts");
      expect(related.content[0].text).toContain("- src/helper.ts");
      expect(related.content[0].text).toContain("- src/index.ts:1 via ./widget");
      expect(related.content[0].text).toContain("- tests/widget.test.ts");

      const likelyTests = await tool.handler({
        action: "likely_tests",
        file: "src/widget.ts",
        budgetBytes: 2048,
      }, testContext(sessionDir));
      expect(likelyTests.isError).toBeUndefined();
      expect(likelyTests.content[0].text).toContain("ctx_code likely_tests: src/widget.ts");
      expect(likelyTests.content[0].text).toContain("- tests/widget.test.ts");
    } finally {
      cleanupProject(projectDir);
    }
  });

  it("handles concurrent cache callers without corrupting the code index", async () => {
    const projectDir = tempProject();
    const sessionDir = join(projectDir, ".context-mode", "sessions");
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      mkdirSync(sessionDir, { recursive: true });
      for (let i = 0; i < 8; i++) {
        writeFileSync(join(projectDir, "src", `symbol-${i}.ts`), [
          `export function cachedSymbol${i}(): number {`,
          `  return ${i};`,
          "}",
        ].join("\n"), "utf8");
      }
      const tool = makeCtxCode({ getProjectDir: () => projectDir });

      const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        tool.handler({ action: "find_symbol", query: `cachedSymbol${i}`, compact: true }, testContext(sessionDir))
      ));

      for (let i = 0; i < results.length; i++) {
        expect(results[i].isError).toBeUndefined();
        expect(results[i].content[0].text).toContain(`cachedSymbol${i}`);
      }

      const related = await tool.handler({ action: "related_files", file: "src/symbol-0.ts" }, testContext(sessionDir));
      expect(related.isError).toBeUndefined();
      expect(related.content[0].text).toContain("ctx_code related_files: src/symbol-0.ts");
    } finally {
      cleanupProject(projectDir);
    }
  });
});
