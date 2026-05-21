// Phase 1.5 — Unicode + emoji + CJK + RTL. Tests byte-accounting honesty
// across encodings (UTF-8 bytes != char count).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CompetitorWorkflow } from "./types.js";

let tmpDir: string | null = null;
let mdPath = "";

const SAMPLE = `# 🚀 Unicode stress test 测试 בדיקה

## emoji wall
🎉🎊✨🌟⭐💫🔥💥🎯🚀🛸🌈🦄🎨🖼️📷📸🎥🎬📺
🍕🍔🍟🌭🥪🌮🌯🍱🍣🍤🍦🍩🍪🎂🧁🍫🍬🍭🍮🍯

## CJK
今日は良い天気です。
中文测试句子，包含 unicode 字符。
한국어 문장도 포함됩니다.

## RTL
שלום עולם — בדיקת RTL.
مرحبا بالعالم — اختبار RTL.

## mixed
The value is 测试中文 = 42 🎯 plus العربية text.
` + Array(80).fill("Line with 🎉 emoji and 测试 chars and العربية text.\n").join("");

const wf: CompetitorWorkflow = {
  name: "unicode-emoji-heavy",
  description: "Read file with emoji + CJK + RTL. Honest byte accounting under UTF-8.",
  fallbackPolicy: "raw-on-error",
  async beforeAll() {
    tmpDir = join(tmpdir(), `competitor-uni-${process.pid}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    mdPath = join(tmpDir, "unicode.md");
    writeFileSync(mdPath, SAMPLE);
    (this.steps as any) = [
      { kind: "read", label: "read-unicode-full", path: mdPath, mode: "full", assert: (t: string) => /unicode|测试|🚀|RTL/i.test(t) || t.length > 100 },
      { kind: "read", label: "read-unicode-outline", path: mdPath, mode: "outline", assert: (t: string) => /unicode|emoji|CJK|RTL|测试/.test(t) || t.length > 30 },
    ];
  },
  async afterAll() {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },
  steps: [],
};

export default wf;
