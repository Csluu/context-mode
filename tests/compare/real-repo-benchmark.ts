// Lightweight real-repo smoke benchmark for context-mode read compression.
//
// Default targets are sibling repos named `mission-control` and
// `widget-launcher`. Override with:
//   CONTEXT_MODE_REAL_REPOS="mission-control=C:\path\repo;widget-launcher=C:\path\repo"

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ctxRead } from "../../src/read/ctx-read.js";
import { buildMeta, reportDir, repoRoot } from "./lib.js";

interface Target {
  name: string;
  path: string;
}

interface RealRepoRow {
  name: string;
  path: string;
  status: "ok" | "missing" | "no-files" | "error";
  file?: string;
  rawBytes?: number;
  mapBytes?: number;
  mapSavedPct?: number;
  rawSliceBytes?: number;
  compactSliceBytes?: number;
  compactSliceOverheadBytes?: number;
  error?: string;
}

const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".cts", ".js", ".jsx", ".json", ".md", ".mjs", ".mts", ".scss", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

const SKIP_DIRS = new Set([
  ".context-mode", ".git", ".next", ".turbo", ".venv", "build", "coverage", "dist", "graphify-out", "node_modules", "out", "target", "vendor",
]);

const SKIP_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function parseTargets(raw = process.env.CONTEXT_MODE_REAL_REPOS): Target[] {
  if (raw?.trim()) {
    return raw
      .split(/[;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((entry) => {
        const eq = entry.indexOf("=");
        if (eq === -1) {
          const path = resolve(entry);
          return { name: basename(path), path };
        }
        const name = entry.slice(0, eq).trim();
        const path = resolve(entry.slice(eq + 1).trim());
        return { name: name || basename(path), path };
      });
  }
  const parent = resolve(repoRoot, "..");
  return [
    { name: "mission-control", path: join(parent, "mission-control") },
    { name: "widget-launcher", path: join(parent, "widget-launcher") },
  ];
}

function collectTextFiles(root: string, maxFiles = 5000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile() || SKIP_FILES.has(entry.name) || !TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      try {
        const st = statSync(full);
        if (st.size > 0 && st.size <= 2_000_000) out.push(full);
      } catch {
        // Ignore races while walking active repos.
      }
    }
  }
  return out;
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function savedPct(rawBytes: number, outputBytes: number): number {
  return rawBytes === 0 ? 0 : Number(((1 - outputBytes / rawBytes) * 100).toFixed(1));
}

function filePriority(file: string): number {
  const ext = extname(file).toLowerCase();
  if ([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"].includes(ext)) return 3;
  if ([".css", ".md", ".scss", ".yaml", ".yml"].includes(ext)) return 2;
  return 1;
}

function rawSlice(text: string, start = 1, end = 20): string {
  return text.split(/\r?\n/).slice(start - 1, end).join("\n");
}

function benchmarkTarget(target: Target): RealRepoRow {
  const root = resolve(target.path);
  if (!existsSync(root)) return { name: target.name, path: root, status: "missing" };
  try {
    const files = collectTextFiles(root);
    if (files.length === 0) return { name: target.name, path: root, status: "no-files" };
    const file = files
      .map((f) => ({ file: f, priority: filePriority(f), size: statSync(f).size }))
      .sort((a, b) => b.priority - a.priority || b.size - a.size)[0].file;
    const raw = readFileSync(file, "utf8");
    const map = ctxRead({ projectDir: root, path: file, mode: "map", compact: true }).text;
    const slice = ctxRead({ projectDir: root, path: file, mode: "slice", compact: true, start: 1, end: 20 }).text;
    const rawSliceText = rawSlice(raw);
    const rawBytes = bytes(raw);
    const rawSliceBytes = bytes(rawSliceText);
    const compactSliceBytes = bytes(slice);
    return {
      name: target.name,
      path: root,
      status: "ok",
      file: relative(root, file),
      rawBytes,
      mapBytes: bytes(map),
      mapSavedPct: savedPct(rawBytes, bytes(map)),
      rawSliceBytes,
      compactSliceBytes,
      compactSliceOverheadBytes: compactSliceBytes - rawSliceBytes,
    };
  } catch (err) {
    return {
      name: target.name,
      path: root,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderMarkdown(rows: RealRepoRow[]): string {
  const lines: string[] = [];
  lines.push("# Real repo compact benchmark");
  lines.push("");
  lines.push("Scope: representative largest text/code file per configured repo; missing repos are skipped.");
  lines.push("");
  lines.push("| Repo | Status | File | Raw B | ctx_read map B | Map saved % | Raw 20-line slice B | Compact slice B | Slice delta B |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.name} | ${row.status}${row.error ? `: ${row.error.replace(/\|/g, "/")}` : ""} | ${row.file ?? "-"} | ${row.rawBytes ?? "-"} | ${row.mapBytes ?? "-"} | ${row.mapSavedPct ?? "-"} | ${row.rawSliceBytes ?? "-"} | ${row.compactSliceBytes ?? "-"} | ${row.compactSliceOverheadBytes ?? "-"} |`);
  }
  lines.push("");
  lines.push("Run with `CONTEXT_MODE_REAL_REPOS=\"name=path;name=path\" npm run compare:real-repos` to target other repositories.");
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  mkdirSync(reportDir, { recursive: true });
  const rows = parseTargets().map(benchmarkTarget);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const meta = buildMeta("real-repos");
  const jsonPath = join(reportDir, `real-repos-${ts}.json`);
  const mdPath = join(reportDir, `real-repos-${ts}.md`);
  writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 2));
  writeFileSync(mdPath, renderMarkdown(rows));
  console.log(`[real-repos] wrote ${jsonPath}`);
  console.log(`[real-repos] wrote ${mdPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
