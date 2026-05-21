import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ctxRead, resolveReadPath } from "../../src/read/ctx-read.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "context-mode-read-"));
}

describe("ctxRead", () => {
  it("returns full numbered content for small files in auto mode", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "src", "small.ts");
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(file, "export function add(a: number, b: number) {\n  return a + b;\n}\n", "utf8");

      const result = ctxRead({ projectDir, path: "src/small.ts" });

      expect(result.mode).toBe("full");
      expect(["typescript-compiler", "heuristic"]).toContain(result.provider);
      expect(result.text).toContain("    1: export function add");
      expect(result.text).toContain("    2:   return a + b;");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("supports symbols, outline, map, and bounded slices", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "large.ts");
      const lines = [
        "import fs from 'node:fs';",
        "export interface Config { enabled: boolean }",
        "export class Runner {",
        "  run(): void {",
        "    return;",
        "  }",
        "}",
        ...Array.from({ length: 700 }, (_, i) => `const value${i} = ${i};`),
      ];
      writeFileSync(file, lines.join("\n"), "utf8");

      const symbols = ctxRead({ projectDir, path: file, mode: "symbols" });
      expect(symbols.text).toContain("interface");
      expect(["typescript-compiler", "heuristic"]).toContain(symbols.provider);
      const outline = ctxRead({ projectDir, path: file, mode: "outline" });
      expect(outline.text).toContain(`provider: ${outline.provider}`);
      expect(ctxRead({ projectDir, path: file, mode: "map" }).text).toContain("Suggested slices:");

      const slice = ctxRead({ projectDir, path: file, mode: "slice", start: 1, end: 1000 });
      expect(slice.truncated).toBe(true);
      expect(slice.text).toContain("    1: import fs");
      expect(slice.text.split("\n").length).toBe(400);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("requires a reason for full reads of large files", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "large.txt");
      writeFileSync(file, Array.from({ length: 501 }, (_, i) => `line ${i}`).join("\n"), "utf8");

      expect(() => ctxRead({ projectDir, path: file, mode: "full" })).toThrow(/requires reason/);
      expect(ctxRead({ projectDir, path: file, mode: "full", reason: "direct edit target" }).mode).toBe("full");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("collapses repeated unchanged large reads and expands after the file changes", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "large.ts");
      writeFileSync(file, Array.from({ length: 650 }, (_, i) => `export const value${i} = ${i};`).join("\n"), "utf8");

      const first = ctxRead({ projectDir, path: file, mode: "outline" });
      const second = ctxRead({ projectDir, path: file, mode: "outline" });

      expect(first.unchangedSinceLastRead).toBeUndefined();
      expect(second.unchangedSinceLastRead).toBe(true);
      expect(second.text).toContain("unchanged since last read");
      expect(second.text).toContain(`hash: ${first.hash}`);

      writeFileSync(file, Array.from({ length: 650 }, (_, i) => `export const changed${i} = ${i};`).join("\n"), "utf8");
      const third = ctxRead({ projectDir, path: file, mode: "outline" });

      expect(third.unchangedSinceLastRead).toBeUndefined();
      expect(third.hash).not.toBe(first.hash);
      expect(third.text).toContain("changed0");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("uses the TypeScript compiler provider when available for richer symbol maps", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "component.ts");
      writeFileSync(file, [
        "import { readFileSync } from 'node:fs';",
        "export interface Props { enabled: boolean }",
        "export class Component {",
        "  private status = 'ready';",
        "  constructor() {}",
        "  render(): string {",
        "    return 'ok';",
        "  }",
        "}",
        "export const App = () => null;",
        "const alpha = 1, beta = 2;",
        ...Array.from({ length: 520 }, (_, i) => `const filler${i} = ${i};`),
      ].join("\n"), "utf8");

      const result = ctxRead({ projectDir, path: file, mode: "symbols" });

      expect(result.provider).toBe("typescript-compiler");
      expect(result.providerConfidence).toBe("high");
      expect(result.text).toContain("interface");
      expect(result.text).toContain("class");
      expect(result.text).toContain("method");
      expect(result.text).toContain("property");
      expect(result.text).toContain("export const App");
      expect(result.text).toContain("const alpha");
      expect(result.text).toContain("const beta");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns compact outline and symbol output with stable line metadata", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "compact.ts");
      writeFileSync(file, [
        "import path from 'node:path';",
        "export interface Config { enabled: boolean }",
        "export class Runner {",
        "  start(): void {}",
        "}",
        "export const run = () => true;",
        ...Array.from({ length: 520 }, (_, i) => `const filler${i} = ${i};`),
      ].join("\n"), "utf8");

      const normal = ctxRead({ projectDir, path: file, mode: "outline" });
      const compactOutline = ctxRead({ projectDir, path: file, mode: "outline", compact: true });
      const compactSymbols = ctxRead({ projectDir, path: file, mode: "symbols", compact: true });

      expect(compactOutline.provider).toBe("typescript-compiler");
      expect(compactOutline.providerConfidence).toBe("high");
      expect(compactOutline.text).toContain("outline compact");
      expect(compactOutline.text).toContain("provider: typescript-compiler confidence=high");
      expect(compactOutline.text).toMatch(/L00002 interface Config/);
      expect(compactOutline.text).toMatch(/L00006 function run \(export const\)/);
      expect(compactOutline.text.length).toBeLessThan(normal.text.length);

      expect(compactSymbols.text).toContain("symbols compact");
      expect(compactSymbols.text).toMatch(/L00003 class Runner/);
      expect(compactSymbols.text).toMatch(/L00004 method start/);
      expect(compactSymbols.text).not.toContain("Suggested slices:");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns compact slice output without padded line-number overhead", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "slice.ts");
      writeFileSync(file, [
        "export const one = 1;",
        "export const two = 2;",
        "export const three = 3;",
      ].join("\n"), "utf8");

      const normal = ctxRead({ projectDir, path: file, mode: "slice", start: 1, end: 3 });
      const compact = ctxRead({ projectDir, path: file, mode: "slice", compact: true, start: 1, end: 3 });

      expect(normal.text).toContain("    1: export const one");
      expect(compact.text).toContain("1: export const one");
      expect(compact.text).not.toContain("    1:");
      expect(compact.text.length).toBeLessThan(normal.text.length);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("renders decorated TypeScript declarations by declaration line instead of decorator line", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "decorated.ts");
      writeFileSync(file, [
        "function Injectable(): ClassDecorator { return () => undefined; }",
        "function Log(): MethodDecorator { return () => undefined; }",
        "@Injectable()",
        "export class Service {",
        "  @Log()",
        "  run(): void {}",
        "}",
      ].join("\n"), "utf8");

      const result = ctxRead({ projectDir, path: file, mode: "symbols" });

      expect(result.provider).toBe("typescript-compiler");
      expect(result.text).toContain("export class Service");
      expect(result.text).toContain("run(): void");
      expect(result.text).not.toContain("class     @Injectable()");
      expect(result.text).not.toContain("method    @Log()");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns a bounded directory map instead of failing on directories", () => {
    const projectDir = tempProject();
    try {
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(join(projectDir, "package.json"), "{}", "utf8");
      writeFileSync(join(projectDir, "src", "index.ts"), "export const ok = true;\n", "utf8");

      const result = ctxRead({ projectDir, path: ".", mode: "map" });

      expect(result.provider).toBe("directory");
      expect(result.text).toContain("Directory map:");
      expect(result.text).toContain("[dir]  src/");
      expect(result.text).toContain("[file] package.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("includes Markdown headings in outline mode", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "GRAPH_REPORT.md");
      writeFileSync(file, [
        "# Graph Report",
        "",
        "## Corpus Check",
        "body",
        "### Community 1",
      ].join("\n"), "utf8");

      const result = ctxRead({ projectDir, path: file, mode: "outline" });

      expect(result.text).toContain("heading");
      expect(result.text).toContain("# Graph Report");
      expect(result.text).toContain("## Corpus Check");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("detects Python functions with the heuristic symbol provider", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "evaluate.py");
      writeFileSync(file, [
        "from pathlib import Path",
        "import json",
        "",
        "async def score_async(value):",
        "    return value",
        "",
        "def evaluate(path):",
        "    return Path(path).exists()",
        "",
        "class Runner:",
        "    pass",
      ].join("\n"), "utf8");

      const result = ctxRead({ projectDir, path: file, mode: "symbols" });

      expect(result.provider).toBe("heuristic");
      expect(result.text).toContain("import");
      expect(result.text).toContain("async def score_async");
      expect(result.text).toContain("def evaluate");
      expect(result.text).toContain("class Runner");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("detects Rust symbols with the heuristic symbol provider", () => {
    const projectDir = tempProject();
    try {
      const file = join(projectDir, "lib.rs");
      writeFileSync(file, [
        "pub mod worker;",
        "pub struct Worker { id: String }",
        "impl Worker {",
        "  pub fn new(id: String) -> Self { Self { id } }",
        "}",
        "pub async fn build_worker() -> Worker {",
        "  Worker::new(\"default\".to_string())",
        "}",
      ].join("\n"), "utf8");

      const result = ctxRead({ projectDir, path: file, mode: "symbols" });

      expect(result.provider).toBe("heuristic");
      expect(result.text).toContain("module");
      expect(result.text).toContain("struct");
      expect(result.text).toContain("impl");
      expect(result.text).toContain("pub fn new");
      expect(result.text).toContain("pub async fn build_worker");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns binary metadata stubs and still blocks path traversal", () => {
    const projectDir = tempProject();
    try {
      const binary = join(projectDir, "image.bin");
      writeFileSync(binary, Buffer.from([0, 1, 2, 3, 4, 5]));
      const result = ctxRead({ projectDir, path: binary, mode: "full" });
      expect(result.provider).toBe("binary-stub");
      expect(result.text).toContain("binary: application/octet-stream");
      expect(result.text).toContain("bytes: 6");
      expect(result.text).toContain("magic: 00 01 02 03 04 05");
      expect(() => resolveReadPath(projectDir, "../outside.txt")).toThrow(/escapes project root/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("blocks sensitive credential-shaped files even without external deny policy", () => {
    const projectDir = tempProject();
    try {
      writeFileSync(join(projectDir, ".env"), "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz\n", "utf8");
      mkdirSync(join(projectDir, ".ssh"), { recursive: true });
      writeFileSync(join(projectDir, ".ssh", "id_ed25519"), "private-key", "utf8");

      expect(() => ctxRead({ projectDir, path: ".env", mode: "full" })).toThrow(/sensitive file blocked/);
      expect(() => ctxRead({ projectDir, path: join(".ssh", "id_ed25519"), mode: "full" })).toThrow(/sensitive file blocked/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("blocks sensitive-looking requested paths before following symlinks", () => {
    const projectDir = tempProject();
    try {
      const target = join(projectDir, "plain.txt");
      const link = join(projectDir, ".env");
      writeFileSync(target, "not-secret", "utf8");
      try {
        symlinkSync(target, link, "file");
      } catch {
        return;
      }

      expect(() => ctxRead({ projectDir, path: ".env", mode: "full" })).toThrow(/sensitive file blocked/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("blocks symlink or junction escapes after realpath resolution", () => {
    const projectDir = tempProject();
    const outsideDir = mkdtempSync(join(tmpdir(), "context-mode-read-outside-"));
    try {
      writeFileSync(join(outsideDir, "secret.txt"), "outside-secret", "utf8");
      const link = join(projectDir, "linked");
      try {
        symlinkSync(outsideDir, link, process.platform === "win32" ? "junction" : "dir");
      } catch {
        return;
      }

      expect(() => ctxRead({ projectDir, path: join("linked", "secret.txt") })).toThrow(/escapes project root/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
