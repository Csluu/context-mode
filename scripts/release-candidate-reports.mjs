#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function reproducibleTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
  return "1970-01-01T00:00:00.000Z";
}

function listFiles(root, relDir, predicate = () => true) {
  const dir = resolve(root, relDir);
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(full)) out.push(full.replace(`${resolve(root)}\\`, "").replace(`${resolve(root)}/`, "").replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

function writeJson(outDir, name, payload) {
  const outPath = join(outDir, name);
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outPath;
}

export function buildAdapterValidationReport(root = process.cwd(), opts = {}) {
  return {
    schemaVersion: 1,
    generatedAt: opts.generatedAt ?? reproducibleTimestamp(),
    validatedBy: [
      "tests/hooks/hook-rewrite.test.ts",
      "tests/cli/hook-self-test.test.ts",
      "tests/adapters/output-budget.test.ts",
    ],
    adapters: [
      { id: "claude-code", tier: "tier 1 candidate", mutation: "stable", proof: "hook-rewrite stable matrix" },
      { id: "cursor", tier: "tier 1 candidate", mutation: "stable", proof: "hook-rewrite stable matrix" },
      { id: "openclaw", tier: "tier 1 candidate", mutation: "stable", proof: "hook-rewrite stable matrix" },
      { id: "opencode", tier: "tier 1 candidate", mutation: "stable", proof: "hook-rewrite stable matrix" },
      { id: "vscode-copilot", tier: "tier 1 candidate", mutation: "stable", proof: "hook-rewrite stable matrix" },
      { id: "gemini-cli", tier: "experimental", mutation: "opt-in", proof: "experimental flag required" },
      { id: "jetbrains-copilot", tier: "experimental", mutation: "opt-in", proof: "experimental flag required" },
      { id: "qwen-code", tier: "experimental", mutation: "opt-in", proof: "experimental flag required" },
      { id: "codex", tier: "mcp-only", mutation: "unsupported", proof: "unsupported mutation matrix" },
    ],
    notes: [
      "No adapter is marked generally tier-1 supported by default; rewrite remains opt-in.",
      "Unsupported adapters receive recommendation/instruction guidance instead of mutation.",
    ],
  };
}

export function buildSchemaSnapshot(root = process.cwd(), opts = {}) {
  const pkg = readJson(resolve(root, "package.json"));
  const toolSources = listFiles(root, "src/tools", (file) => /\.(ts|mts)$/.test(file));
  return {
    schemaVersion: 1,
    generatedAt: opts.generatedAt ?? reproducibleTimestamp(),
    package: {
      name: pkg.name,
      version: pkg.version,
      bin: pkg.bin,
    },
    configSchemaVersion: 1,
    toolSources,
    routingSources: listFiles(root, "src/routing", (file) => file.endsWith(".ts")),
    parserSources: listFiles(root, "src/parsers", (file) => file.endsWith(".ts")),
    guardSources: listFiles(root, "src/guard", (file) => file.endsWith(".ts")),
    evalSources: listFiles(root, "src/eval", (file) => file.endsWith(".ts")),
    traceSources: listFiles(root, "src/trace", (file) => file.endsWith(".ts")),
    diffSources: listFiles(root, "src/diff", (file) => file.endsWith(".ts")),
    cacheSources: listFiles(root, "src/cache", (file) => file.endsWith(".ts")),
  };
}

export function buildFixtureCoverage(root = process.cwd(), opts = {}) {
  const fixtures = listFiles(root, "tests/fixtures");
  const requiredCoverageEvidence = [
    {
      area: "secret redaction",
      files: ["tests/artifacts/run-store.test.ts"],
    },
    {
      area: "ANSI/control stripping",
      files: ["tests/filters/pipeline.test.ts"],
    },
    {
      area: "parser failure fail-open",
      files: ["tests/tools/execute-sidecar-integration.test.ts", "tests/parsers/registry.test.ts"],
    },
    {
      area: "sidecar fetch/truncation/pinning",
      files: ["tests/tools/route-fetch-run.test.ts", "tests/artifacts/run-store.test.ts"],
    },
    {
      area: "sidecar TTL and project quota cleanup",
      files: ["tests/artifacts/run-store.test.ts"],
    },
    {
      area: "stdin/heredoc classification",
      files: ["tests/routing/route-explain.test.ts"],
    },
    {
      area: "interactive/watch classify-only routing",
      files: ["tests/routing/route-explain.test.ts", "tests/hooks/hook-rewrite.test.ts"],
    },
    {
      area: "adapter output budget truncation",
      files: ["tests/adapters/output-budget.test.ts"],
    },
    {
      area: "ctx_read binary/path/symlink/repeated-read behavior",
      files: ["tests/read/ctx-read.test.ts", "tests/tools/read.test.ts"],
    },
    {
      area: "ctx_guard deterministic scanner",
      files: ["tests/guard/scanner.test.ts"],
    },
    {
      area: "ctx_eval fast fixture harness",
      files: ["tests/eval/harness.test.ts"],
    },
    {
      area: "ctx_trace local trace views",
      files: ["tests/trace/summary.test.ts"],
    },
    {
      area: "ctx_diff raw inventory preservation",
      files: ["tests/diff/git-text.test.ts"],
    },
    {
      area: "ctx_cache explain and explicit tsc cache canary safety",
      files: ["tests/cache/explain.test.ts"],
    },
  ];
  const focusedTests = [
    "tests/artifacts/run-store.test.ts",
    "tests/adapters/output-budget.test.ts",
    "tests/config/context-mode-config.test.ts",
    "tests/executor.test.ts",
    "tests/filters/pipeline.test.ts",
    "tests/hooks/hook-rewrite.test.ts",
    "tests/parsers/registry.test.ts",
    "tests/read/ctx-read.test.ts",
    "tests/routing/route-explain.test.ts",
    "tests/tools/discover.test.ts",
    "tests/tools/execute-sidecar-integration.test.ts",
    "tests/guard/scanner.test.ts",
    "tests/eval/harness.test.ts",
    "tests/trace/summary.test.ts",
    "tests/diff/git-text.test.ts",
    "tests/cache/explain.test.ts",
  ].filter((file) => existsSync(resolve(root, file)));
  const coverageEvidence = requiredCoverageEvidence.map((entry) => ({
    area: entry.area,
    files: entry.files,
    present: entry.files.filter((file) => existsSync(resolve(root, file))),
    missing: entry.files.filter((file) => !existsSync(resolve(root, file))),
  }));
  const missingEvidence = coverageEvidence
    .filter((entry) => entry.present.length === 0)
    .map((entry) => entry.area);
  return {
    schemaVersion: 1,
    generatedAt: opts.generatedAt ?? reproducibleTimestamp(),
    fixtureCount: fixtures.length,
    fixtures,
    focusedTests,
    coverageAreas: coverageEvidence.map((entry) => entry.area),
    coverageEvidence,
    missingEvidence,
  };
}

export function buildSemanticDiffFixtureReport(root = process.cwd(), opts = {}) {
  const required = [
    "src/diff/git-text.ts",
    "src/tools/diff.ts",
    "tests/diff/git-text.test.ts",
  ];
  const present = required.filter((file) => existsSync(resolve(root, file)));
  return {
    schemaVersion: 1,
    generatedAt: opts.generatedAt ?? reproducibleTimestamp(),
    provider: "git-text",
    difftastic: "optional-capability-detected-not-required",
    rawInventoryPreserved: present.includes("tests/diff/git-text.test.ts"),
    required,
    present,
    missing: required.filter((file) => !present.includes(file)),
  };
}

export function buildTaskCacheReadinessReport(root = process.cwd(), opts = {}) {
  const required = [
    "src/cache/explain.ts",
    "src/cache/run.ts",
    "src/tools/cache.ts",
    "tests/cache/explain.test.ts",
  ];
  const present = required.filter((file) => existsSync(resolve(root, file)));
  return {
    schemaVersion: 1,
    generatedAt: opts.generatedAt ?? reproducibleTimestamp(),
    servingEnabled: "explicit-canary-only",
    firstDeliverable: "ctx_cache explain + explicit tsc --noEmit canary",
    cacheHitServingAdvertised: "experimental-tool-and-cli-only",
    required,
    present,
    missing: required.filter((file) => !present.includes(file)),
  };
}

export function buildReleaseChecklist(root = process.cwd(), opts = {}) {
  const generatedAt = opts.generatedAt ?? reproducibleTimestamp();
  const required = [
    "build/benchmark-report.json",
    "build/adapter-validation-report.json",
    "build/schema-snapshot.json",
    "build/fixture-coverage.json",
    "build/eval-full-report.json",
    "build/guard-fixtures-report.json",
    "build/skip-audit-report.json",
    "build/semantic-diff-fixture-report.json",
    "build/task-cache-readiness-report.json",
    "build/release-sbom.json",
    "build/SHA256SUMS",
    "build/release-provenance.intoto.json",
  ];
  const lines = [
    "# Release Checklist",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Required Artifacts",
    "",
    ...required.map((artifact) => `- [${existsSync(resolve(root, artifact)) ? "x" : " "}] \`${artifact}\``),
    "",
    "## Required Gates",
    "",
    "- [ ] `npm test`",
    "- [ ] `npm run eval:fast`",
    "- [ ] `npm run guard:fixtures`",
    "- [ ] `npm run skip:audit:strict`",
    "- [ ] `npm run precommit`",
    "- [ ] `npm run benchmark:check`",
    "- [ ] `npm run release:verify` on a clean worktree",
    "- [ ] temporary install smoke from `release-artifacts/*.tgz`",
    "- [ ] plugin manifest version sync reviewed",
    "- [ ] external telemetry absent or separately reviewed",
    "- [ ] release signing note or signature reviewed",
    "",
  ];
  return lines.join("\n");
}

export function writeReleaseCandidateReports(root = process.cwd(), opts = {}) {
  const outDir = resolve(root, opts.outDir ?? "build");
  mkdirSync(outDir, { recursive: true });
  const generatedAt = opts.generatedAt ?? reproducibleTimestamp();
  const written = [
    writeJson(outDir, "adapter-validation-report.json", buildAdapterValidationReport(root, { generatedAt })),
    writeJson(outDir, "schema-snapshot.json", buildSchemaSnapshot(root, { generatedAt })),
  ];
  const fixtureCoverage = buildFixtureCoverage(root, { generatedAt });
  if (fixtureCoverage.missingEvidence.length > 0) {
    throw new Error(`fixture coverage evidence missing for: ${fixtureCoverage.missingEvidence.join(", ")}`);
  }
  written.push(writeJson(outDir, "fixture-coverage.json", fixtureCoverage));
  const semanticDiff = buildSemanticDiffFixtureReport(root, { generatedAt });
  if (semanticDiff.missing.length > 0) {
    throw new Error(`semantic diff fixture evidence missing: ${semanticDiff.missing.join(", ")}`);
  }
  written.push(writeJson(outDir, "semantic-diff-fixture-report.json", semanticDiff));
  const taskCache = buildTaskCacheReadinessReport(root, { generatedAt });
  if (taskCache.missing.length > 0) {
    throw new Error(`task cache readiness evidence missing: ${taskCache.missing.join(", ")}`);
  }
  written.push(writeJson(outDir, "task-cache-readiness-report.json", taskCache));
  const checklist = buildReleaseChecklist(root, { generatedAt });
  const checklistPath = join(outDir, "release-checklist.md");
  writeFileSync(checklistPath, checklist, "utf8");
  written.push(checklistPath);
  return written;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") opts.outDir = argv[++i];
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const written = writeReleaseCandidateReports(process.cwd(), parseArgs(process.argv.slice(2)));
    console.log(`release-candidate-reports OK: ${written.map((file) => basename(file)).join(", ")}`);
  } catch (err) {
    console.error(`release-candidate-reports failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
