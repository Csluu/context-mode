#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const testsDir = join(root, "tests");
const outPath = resolve(process.argv.includes("--json-out") ? process.argv[process.argv.indexOf("--json-out") + 1] : "build/skip-audit-report.json");
const strict = process.argv.includes("--strict") || process.env.CONTEXT_MODE_STRICT_SKIP_AUDIT === "1";
const manifestPath = join(root, "tests", "skip-manifest.json");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".git", "build", "dist"].includes(entry.name)) walk(abs, out);
      continue;
    }
    if (/\.(test|spec)\.[cm]?[jt]s$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : undefined;

function asEntries(value) {
  if (!value) return [];
  const allowed = Array.isArray(value.allowed)
    ? value.allowed.map((id) => ({ id, owner: "legacy", reason: "legacy allowed entry", expiry: "2099-12-31" }))
    : [];
  const entries = Array.isArray(value.entries) ? value.entries : [];
  return [...allowed, ...entries];
}

const manifestEntries = asEntries(manifest);

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function validateManifestEntry(entry) {
  const missing = [];
  if (!entry || typeof entry !== "object") return ["entry is not an object"];
  if (!entry.id && !entry.file) missing.push("id-or-file");
  if (!entry.owner) missing.push("owner");
  if (!entry.reason) missing.push("reason");
  if (!entry.expiry) missing.push("expiry");
  if (entry.expiry && Number.isNaN(Date.parse(`${entry.expiry}T00:00:00Z`))) missing.push("valid-expiry");
  return missing;
}

const manifestIssues = [];
for (const [idx, entry] of manifestEntries.entries()) {
  const missing = validateManifestEntry(entry);
  if (missing.length > 0) {
    manifestIssues.push({ index: idx, issue: `invalid manifest entry: ${missing.join(", ")}` });
  }
}

function findManifestEntry(finding) {
  const now = new Date();
  for (const entry of manifestEntries) {
    const missing = validateManifestEntry(entry);
    if (missing.length > 0) continue;
    const idMatch = entry.id
      ? globToRegExp(entry.id).test(finding.id)
      : false;
    const fileMatch = entry.file
      ? globToRegExp(entry.file).test(finding.file)
      : false;
    if (!idMatch && !fileMatch) continue;
    if (entry.kind && entry.kind !== finding.kind) continue;
    const expiry = new Date(`${entry.expiry}T23:59:59Z`);
    if (expiry < now) {
      manifestIssues.push({ id: finding.id, issue: `expired manifest entry: ${entry.expiry}` });
      return undefined;
    }
    return entry;
  }
  return undefined;
}

const findings = [];
for (const file of existsSync(testsDir) ? walk(testsDir) : []) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (!/(?:describe|it|test)\.skip|skipIf\(|\.todo\(/.test(line)) return;
    const id = `${rel}:${idx + 1}`;
    const kind = line.includes("skipIf(") ? "skipIf" : line.includes(".todo(") ? "todo" : "skip";
    const candidate = {
      id,
      file: rel,
      line: idx + 1,
      kind,
      text: line.trim().slice(0, 200),
    };
    const match = findManifestEntry(candidate);
    findings.push({
      ...candidate,
      manifested: Boolean(match) || /skip-audit:\s*allow/.test(line),
      manifestOwner: match?.owner,
      manifestReason: match?.reason,
      manifestExpiry: match?.expiry,
    });
  });
}

const unknown = findings.filter((item) => !item.manifested);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  manifestPath: relative(root, manifestPath).replace(/\\/g, "/"),
  manifestPresent: existsSync(manifestPath),
  manifestEntries: manifestEntries.length,
  manifestIssues,
  total: findings.length,
  manifested: findings.length - unknown.length,
  unknown: unknown.length,
  findings,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`skip-audit: ${report.total} skip markers, ${report.unknown} without manifest, ${report.manifestIssues.length} manifest issues -> ${relative(root, outPath)}`);

if (strict && (unknown.length > 0 || manifestIssues.length > 0)) {
  process.exit(1);
}
