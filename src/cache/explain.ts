import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyCommand, redactCommandShape } from "../routing/command-classifier.js";

export type CacheDecision = "eligible" | "bypass";

export interface CacheInputFingerprint {
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly sha256?: string;
}

export interface CacheExplainResult {
  readonly schemaVersion: 1;
  readonly decision: CacheDecision;
  readonly servingEnabled: false;
  readonly commandFamily: string;
  readonly commandShape: string;
  readonly cacheKey?: string;
  readonly reasonCodes: readonly string[];
  readonly invalidationInputs: readonly CacheInputFingerprint[];
  readonly envShape: Record<string, string>;
  readonly git?: {
    readonly branch?: string;
    readonly commit?: string;
  };
}

interface FamilyPolicy {
  readonly family: string;
  readonly match: (argv: readonly string[], normalized: string) => boolean;
  readonly inputs: readonly string[];
  readonly includeSourceFiles?: boolean;
}

export interface ExplainTaskCacheOptions {
  readonly command: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
}

const POLICIES: readonly FamilyPolicy[] = [
  {
    family: "tsc-noemit",
    match: (argv) => argv[0] === "tsc" && argv.includes("--noEmit"),
    inputs: ["package.json", "tsconfig.json", "tsconfig.build.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"],
    includeSourceFiles: true,
  },
  {
    family: "eslint",
    match: (argv) => ["eslint", "eslint.cmd"].includes(argv[0] ?? ""),
    inputs: ["package.json", "eslint.config.js", ".eslintrc", ".eslintrc.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"],
  },
  {
    family: "vitest-run",
    match: (argv) => argv[0] === "vitest" && argv.includes("run"),
    inputs: ["package.json", "vitest.config.ts", "vitest.config.js", "vite.config.ts", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"],
  },
  {
    family: "pytest",
    match: (argv, normalized) => argv[0] === "pytest" && !/\b(-f|--looponfail|--pdb|-s)\b/.test(normalized),
    inputs: ["pyproject.toml", "pytest.ini", "requirements.txt", "uv.lock", "poetry.lock"],
  },
  {
    family: "go-test",
    match: (argv) => argv[0] === "go" && argv[1] === "test",
    inputs: ["go.mod", "go.sum"],
  },
  {
    family: "git-status",
    match: (argv) => argv[0] === "git" && argv[1] === "status",
    inputs: [".git/index"],
  },
  {
    family: "git-diff",
    match: (argv) => argv[0] === "git" && argv[1] === "diff",
    inputs: [".git/index"],
  },
];

const NEVER_CACHE = [
  /\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|upgrade|create|init)\b/i,
  /\b(?:db|prisma|sequelize|knex).{0,40}\b(?:migrate|deploy|seed)\b/i,
  /\b(?:deploy|publish|release)\b/i,
  /\b(?:dev|serve|--watch|watch|tail\s+-f)\b/i,
  /\b(?:ssh|sudo|vim|nano|less)\b/i,
];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function gitInfo(cwd: string): CacheExplainResult["git"] {
  try {
    const branch = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    const commit = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    return { branch, commit };
  } catch {
    return undefined;
  }
}

function fingerprint(cwd: string, name: string): CacheInputFingerprint {
  const path = join(cwd, name);
  if (!existsSync(path)) return { name, path, exists: false };
  const stat = statSync(path);
  const sha = stat.isFile() && stat.size <= 512 * 1024
    ? sha256(readFileSync(path, "utf8"))
    : undefined;
  return {
    name,
    path,
    exists: true,
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    ...(sha ? { sha256: sha } : {}),
  };
}

function collectSourceFingerprints(cwd: string, maxFiles = 1000): CacheInputFingerprint[] {
  const out: CacheInputFingerprint[] = [];
  const skipDirs = new Set([".git", ".context-mode", "node_modules", "dist", "build", "coverage"]);
  const visit = (dir: string, relDir = ""): void => {
    if (out.length >= maxFiles) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const rel = relDir ? join(relDir, entry.name) : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) visit(abs, rel);
        continue;
      }
      if (!entry.isFile() || !/\.[cm]?tsx?$/.test(entry.name)) continue;
      out.push(fingerprint(cwd, rel));
    }
  };
  visit(cwd);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function envShape(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys = ["CI", "NODE_ENV", "PYTHONPATH", "TZ", "LANG"];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) out[key] = value.length > 0 ? "<set>" : "<empty>";
  }
  return out;
}

function cacheKey(parts: unknown): string {
  return sha256(JSON.stringify(parts)).slice(0, 32);
}

export function explainTaskCache(opts: ExplainTaskCacheOptions): CacheExplainResult {
  const classified = classifyCommand(opts.command);
  const commandShape = redactCommandShape(classified.normalized);
  const reasons: string[] = [];
  const env = opts.env ?? process.env;

  if (NEVER_CACHE.some((pattern) => pattern.test(classified.normalized))) reasons.push("never-cache-command");
  if (classified.interactivity.interactiveRisk !== "none") reasons.push(`interactive-${classified.interactivity.interactiveRisk}`);
  if (classified.input.stdinPresent) reasons.push("stdin-present");
  if (classified.hasRedirection) reasons.push("redirection-present");
  if (classified.hasSubshell) reasons.push("subshell-present");
  if (classified.hasCompoundOperators) reasons.push("compound-command");
  if (classified.argv[0] === "git" && ["status", "diff"].includes(classified.argv[1] ?? "")) {
    reasons.push("git-working-tree-state-not-fingerprinted");
  }

  const policy = POLICIES.find((item) => item.match(classified.argv, classified.normalized));
  if (!policy) reasons.push("no-approved-command-family");

  const invalidationInputs = [
    ...(policy?.inputs ?? ["package.json"]).map((name) => fingerprint(opts.cwd, name)),
    ...(policy?.includeSourceFiles ? collectSourceFingerprints(opts.cwd) : []),
  ];
  const git = gitInfo(opts.cwd);
  const shape = envShape(env);
  const bypass = reasons.length > 0;
  return {
    schemaVersion: 1,
    decision: bypass ? "bypass" : "eligible",
    servingEnabled: false,
    commandFamily: policy?.family ?? "unknown",
    commandShape,
    ...(bypass ? {} : {
      cacheKey: cacheKey({
        commandShape,
        cwd: opts.cwd,
        invalidationInputs,
        envShape: shape,
        git,
      }),
    }),
    reasonCodes: bypass ? reasons : ["explain-only", "serving-disabled"],
    invalidationInputs,
    envShape: shape,
    ...(git ? { git } : {}),
  };
}

export function renderCacheExplain(result: CacheExplainResult): string {
  const lines = [
    `ctx_cache explain: ${result.decision}`,
    `family: ${result.commandFamily}`,
    `serving: disabled`,
    `command: ${result.commandShape}`,
    `reasons: ${result.reasonCodes.join(", ")}`,
  ];
  if (result.cacheKey) lines.push(`key: ${result.cacheKey}`);
  if (result.git?.branch || result.git?.commit) {
    lines.push(`git: ${result.git.branch ?? "unknown"} ${result.git.commit?.slice(0, 12) ?? ""}`.trim());
  }
  lines.push("", "Invalidation inputs:");
  for (const input of result.invalidationInputs) {
    lines.push(`- ${input.name}: ${input.exists ? `${input.size ?? 0}B mtime=${input.mtimeMs ?? 0}` : "missing"}`);
  }
  return lines.join("\n");
}
