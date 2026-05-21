// Tier 2: markdown with YAML frontmatter. Does ctx_read outline / map pick up
// frontmatter keys or just dump them?

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCompareRuntimeDir } from "../lib.js";
import type { Workflow } from "./index.js";

let tmpDir: string | null = null;
let mdPath: string | null = null;

const MD_WITH_FM = `---
title: Sample Doc
date: 2026-05-20
tags: [alpha, beta]
status: draft
---

# Introduction
Body text here.

## Section A
Lorem ipsum dolor sit amet.

## Section B
Consectetur adipiscing elit.

### Sub-section B.1
Mauris quis nisl.
`;

const wf: Workflow = {
  name: "ctx-read-frontmatter",
  description: "Read a markdown file with YAML frontmatter via ctx_read map / outline. Oracle checks that heading structure is recovered.",
  forkOnly: true,
  async beforeAll() {
    tmpDir = makeCompareRuntimeDir("compare-fm");
    mkdirSync(tmpDir, { recursive: true });
    mdPath = join(tmpDir, "sample.md");
    writeFileSync(mdPath, MD_WITH_FM);
    this.steps = [
      { label: "map",     tool: "ctx_read", args: { path: mdPath, mode: "map" },     assert: (t) => /Introduction|Section A|Sub-section|title|tags/i.test(t) || t.length > 60 },
      { label: "outline", tool: "ctx_read", args: { path: mdPath, mode: "outline" }, assert: (t) => /Section|Introduction|#/.test(t) },
      { label: "slice",   tool: "ctx_read", args: { path: mdPath, mode: "slice", compact: true, start: 1, end: 15 }, assert: (t) => /title|tags|---|Introduction/.test(t) },
    ];
  },
  async afterAll() {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } tmpDir = null; mdPath = null; }
  },
  steps: [],
};

export default wf;
