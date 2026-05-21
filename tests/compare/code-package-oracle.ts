import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly value: unknown;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "build", "compare");
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const check = args.includes("--check");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly files?: string[];
};

const packCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const packArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", "npm.cmd pack --dry-run --json"]
  : ["pack", "--dry-run", "--json"];
const pack = spawnSync(packCommand, packArgs, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 10,
  timeout: 120_000,
  windowsHide: true,
});

let packFiles: string[] = [];
let packError = "";
try {
  const parsed = JSON.parse(pack.stdout || "[]") as Array<{ files?: Array<{ path?: string }> }>;
  packFiles = parsed.flatMap((entry) => entry.files ?? []).map((file) => file.path ?? "").filter(Boolean);
} catch (err) {
  packError = err instanceof Error ? err.message : String(err);
}

const checks: Check[] = [
  {
    name: "typescript-runtime-dependency",
    pass: Boolean(pkg.dependencies?.typescript) && !pkg.devDependencies?.typescript,
    value: {
      dependencies: pkg.dependencies?.typescript ?? null,
      devDependencies: pkg.devDependencies?.typescript ?? null,
    },
  },
  {
    name: "package-files-include-build-js",
    pass: pkg.files?.includes("build/**/*.js") === true,
    value: pkg.files ?? [],
  },
  {
    name: "built-static-code-files-exist",
    pass: [
      "build/code/parser.js",
      "build/code/service.js",
      "build/code/index-store.js",
      "build/tools/code.js",
      "build/tools/code.d.ts",
    ].every((file) => existsSync(join(root, file))),
    value: [
      "build/code/parser.js",
      "build/code/service.js",
      "build/code/index-store.js",
      "build/tools/code.js",
      "build/tools/code.d.ts",
    ],
  },
  {
    name: "dry-run-pack-succeeded",
    pass: pack.status === 0 && !packError,
    value: { status: pack.status, signal: pack.signal, error: pack.error?.message ?? (packError || null) },
  },
  {
    name: "packed-artifact-contains-static-code",
    pass: [
      "build/code/parser.js",
      "build/code/service.js",
      "build/code/index-store.js",
      "build/tools/code.js",
      "build/tools/code.d.ts",
    ].every((file) => packFiles.includes(file)),
    value: packFiles.filter((file) => file.startsWith("build/code/") || file === "build/tools/code.js" || file === "build/tools/code.d.ts"),
  },
  {
    name: "packed-artifact-omits-source-code-index",
    pass: !packFiles.some((file) => file.startsWith("src/code/") || file === "src/tools/code.ts"),
    value: packFiles.filter((file) => file.startsWith("src/code/") || file === "src/tools/code.ts"),
  },
];

const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");
const decision = checks.every((item) => item.pass) ? "pass" : "not-ready";
const payload = {
  generatedAt,
  decision,
  packFileCount: packFiles.length,
  checks,
};
const jsonPath = join(outDir, `code-package-oracle-${stamp}.json`);
const mdPath = join(outDir, `code-package-oracle-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
writeFileSync(mdPath, renderMarkdown(payload));

console.log(JSON.stringify({ decision, jsonPath, mdPath, checks }, null, 2));
if (check && decision !== "pass") process.exit(1);

function renderMarkdown(input: typeof payload): string {
  const lines = [
    "# Code Package Oracle",
    "",
    `Generated: ${input.generatedAt}`,
    `Decision: ${input.decision}`,
    `Pack file count: ${input.packFileCount}`,
    "",
    "| Check | Result | Value |",
    "|---|---|---|",
  ];
  for (const item of input.checks) {
    lines.push(`| ${item.name} | ${item.pass ? "pass" : "not-ready"} | ${JSON.stringify(item.value).replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  return lines.join("\n");
}
