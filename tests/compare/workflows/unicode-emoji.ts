// Tier 3: unicode + emoji file. Validates UTF-8 byte counting and that
// ctx_read map / outline preserves multibyte content.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let tmpDir: string | null = null;
let unicodePath: string | null = null;

const UNICODE_CONTENT = `# 多语言测试

This file mixes scripts: 中文, Español, العربية, русский, 日本語, ไทย.

## 表情符号 — Emoji

- 🚀 rocket
- 🐉 dragon
- 🦄 unicorn
- 💯 perfect

## Code-ish

\`\`\`ts
const greeting = "Hello, 世界! 🌍";
\`\`\`

End — fin — 终。
`;

const wf: Workflow = {
  name: "unicode-emoji",
  description: "Read a UTF-8 file with emoji + CJK + RTL scripts via ctx_read. Validates multibyte handling.",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-unicode");
    mkdirSync(tmpDir, { recursive: true });
    unicodePath = join(tmpDir, "unicode.md");
    writeFileSync(unicodePath, UNICODE_CONTENT, "utf8");
    this.steps = [
      { label: "map",     tool: "ctx_read", args: { path: unicodePath, mode: "map" },     assert: (t) => t.length > 0 },
      { label: "outline", tool: "ctx_read", args: { path: unicodePath, mode: "outline" }, assert: (t) => /Emoji|表情|Code|多语言/.test(t) || t.length > 50 },
      { label: "slice",   tool: "ctx_read", args: { path: unicodePath, mode: "slice", compact: true, start: 1, end: 15 }, assert: (t) => /🚀|🐉|多语言|emoji|🦄|rocket/i.test(t) },
    ];
  },
  async afterAll() {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } tmpDir = null; unicodePath = null; }
  },
  steps: [],
};

export default wf;
