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
        "export interface Props { enabled: boolean }",
        "export class Component {",
        "  render(): string {",
        "    return 'ok';",
        "  }",
        "}",
        ...Array.from({ length: 520 }, (_, i) => `const filler${i} = ${i};`),
      ].join("\n"), "utf8");

      const result = ctxRead({ projectDir, path: file, mode: "symbols" });

      expect(result.provider).toBe("typescript-compiler");
      expect(result.text).toContain("interface");
      expect(result.text).toContain("class");
      expect(result.text).toContain("method");
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

  it("blocks binary files and path traversal", () => {
    const projectDir = tempProject();
    try {
      const binary = join(projectDir, "image.bin");
      writeFileSync(binary, Buffer.from([0, 1, 2, 3, 4, 5]));
      expect(() => ctxRead({ projectDir, path: binary, mode: "full" })).toThrow(/binary file blocked/);
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
