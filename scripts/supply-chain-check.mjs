#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepublishOnly", "prepare"];
const ALLOWED_LICENSE_IDS = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Elastic-2.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "WTFPL",
]);
const REMOTE_EXEC_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bInvoke-WebRequest\b/i,
  /\biwr\b/i,
  /\birm\b/i,
  /https?:\/\/[^\s]+.*\|\s*(?:sh|bash|node|powershell|pwsh)/i,
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  return existsSync(filePath) ? readJson(filePath) : null;
}

function dependencyEntries(pkg) {
  const sections = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"];
  const entries = [];
  for (const section of sections) {
    const deps = pkg[section] ?? {};
    for (const name of Object.keys(deps)) {
      entries.push({ name, requested: deps[name], scope: section });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
}

function dependencyRequestMap(pkg) {
  const map = new Map();
  for (const dep of dependencyEntries(pkg)) {
    map.set(dep.name, dep);
  }
  return map;
}

function packageNameFromLockPath(lockPath) {
  const parts = lockPath.split(/[/\\]/);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex >= parts.length - 1) return null;
  const first = parts[nodeModulesIndex + 1];
  if (first?.startsWith("@")) {
    const second = parts[nodeModulesIndex + 2];
    return second ? `${first}/${second}` : null;
  }
  return first ?? null;
}

function lockDependencyEntries(root, pkg) {
  const lock = readJsonIfExists(join(root, "package-lock.json"));
  if (!lock?.packages || typeof lock.packages !== "object") return [];
  const requests = dependencyRequestMap(pkg);
  const entries = [];
  for (const [lockPath, meta] of Object.entries(lock.packages)) {
    if (!lockPath.startsWith("node_modules/")) continue;
    const name = packageNameFromLockPath(lockPath);
    if (!name) continue;
    const requested = requests.get(name);
    entries.push({
      name,
      requested: requested?.requested ?? meta.version ?? "",
      scope: requested?.scope ?? "transitive",
      lockPath,
      version: meta.version,
      resolved: meta.resolved,
      integrity: meta.integrity,
      license: meta.license,
      hasInstallScript: Boolean(meta.hasInstallScript),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.lockPath.localeCompare(b.lockPath));
}

function dependencyPackageJson(root, name) {
  return join(root, "node_modules", ...name.split("/"), "package.json");
}

function packageLicense(pkg) {
  if (typeof pkg.license === "string" && pkg.license.trim()) return pkg.license.trim();
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses
      .map((item) => typeof item === "string" ? item : item?.type)
      .filter(Boolean)
      .join(" OR ");
  }
  return "";
}

export function validateLicenseExpression(license) {
  if (typeof license !== "string" || !license.trim()) {
    return { ok: false, reason: "missing license expression" };
  }
  const expression = license.trim();
  const unknownTokens = [];
  const tokens = expression.match(/[A-Za-z0-9-.+]+/g) ?? [];
  for (const token of tokens) {
    if (token === "AND" || token === "OR" || token === "WITH") continue;
    if (!ALLOWED_LICENSE_IDS.has(token)) unknownTokens.push(token);
  }
  if (unknownTokens.length > 0) {
    return { ok: false, reason: `unapproved or non-SPDX license id: ${[...new Set(unknownTokens)].join(", ")}` };
  }
  if (/[^A-Za-z0-9-.+()\s]/.test(expression)) {
    return { ok: false, reason: "license expression contains unsupported characters" };
  }
  return { ok: true, reason: "approved SPDX license expression" };
}

function reproducibleTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  return "1970-01-01T00:00:00.000Z";
}

function sbomDependencyEntries(root, pkg) {
  const lockEntries = lockDependencyEntries(root, pkg);
  return lockEntries.length > 0
    ? lockEntries
    : dependencyEntries(pkg).map((dep) => ({ ...dep, lockPath: `node_modules/${dep.name}` }));
}

export function buildSbom(root = process.cwd(), opts = {}) {
  const pkg = readJson(join(root, "package.json"));
  const components = sbomDependencyEntries(root, pkg).map((dep) => {
    const depPkgPath = dependencyPackageJson(root, dep.name);
    const depPkg = readJsonIfExists(depPkgPath) ?? {};
    return {
      name: dep.name,
      version: depPkg.version ?? dep.version ?? dep.requested,
      requested: dep.requested,
      scope: dep.scope,
      lockPath: dep.lockPath,
      license: packageLicense(depPkg) || dep.license || "",
      resolved: dep.resolved,
      integrity: dep.integrity,
      lifecycleScripts: LIFECYCLE_SCRIPTS.filter((scriptName) => typeof depPkg.scripts?.[scriptName] === "string"),
      packageJsonFound: existsSync(depPkgPath),
    };
  });

  return {
    bomFormat: "context-mode-simple-sbom",
    schemaVersion: 1,
    generatedAt: opts.generatedAt ?? reproducibleTimestamp(),
    generatedAtSource: opts.generatedAt
      ? "explicit"
      : process.env.SOURCE_DATE_EPOCH
        ? "SOURCE_DATE_EPOCH"
        : "reproducible-default",
    package: {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
    },
    components,
  };
}

function assertNoRemoteExec(label, content, failures) {
  for (const pattern of REMOTE_EXEC_PATTERNS) {
    if (pattern.test(content)) {
      failures.push(`${label} contains remote-fetch or pipe-to-shell pattern: ${pattern}`);
    }
  }
}

function collectScriptFiles(root) {
  const scriptsDir = join(root, "scripts");
  const files = [];
  if (existsSync(scriptsDir)) {
    const stack = [scriptsDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          stack.push(path);
        } else if (/\.(?:mjs|cjs|js|sh|ps1)$/.test(entry)) {
          files.push(path);
        }
      }
    }
  }
  return files.sort();
}

function assertNoUnpinnedBetterSqliteInstall(label, content, failures) {
  if (/better-sqlite3@",/.test(content) || /better-sqlite3@\$/.test(content)) return;
  if (/npm(?:\.cmd)?["'`)]?\s*,?\s*["'`]install["'`][\s\S]{0,300}?["'`]better-sqlite3["'`]/i.test(content)) {
    failures.push(`${label} runs npm install better-sqlite3 without an exact package spec`);
  }
  if (/\bnpm(?:\.cmd)?\s+install\s+better-sqlite3(?:\s|$)/i.test(content)) {
    failures.push(`${label} runs npm install better-sqlite3 without an exact package spec`);
  }
}

export function runSupplyChainChecks(root = process.cwd(), opts = {}) {
  const failures = [];
  const pkgPath = join(root, "package.json");
  const pkg = readJson(pkgPath);

  const packageLicenseCheck = validateLicenseExpression(pkg.license);
  if (!packageLicenseCheck.ok) {
    failures.push(`package.json license invalid: ${packageLicenseCheck.reason}`);
  }
  if (!existsSync(join(root, "LICENSE"))) {
    failures.push("LICENSE file is missing");
  }
  if (!pkg.bin || !pkg.bin["context-mode"]) {
    failures.push("package.json bin.context-mode is missing");
  } else if (!existsSync(join(root, pkg.bin["context-mode"]))) {
    failures.push(`bin.context-mode target is missing: ${pkg.bin["context-mode"]}`);
  }

  for (const scriptName of LIFECYCLE_SCRIPTS) {
    const script = pkg.scripts?.[scriptName];
    if (typeof script === "string") {
      assertNoRemoteExec(`package script ${scriptName}`, script, failures);
    }
  }

  for (const filePath of collectScriptFiles(root)) {
    const label = filePath.replace(`${resolve(root)}${filePath.includes("\\") ? "\\" : "/"}`, "").replace(/\\/g, "/");
    const content = readFileSync(filePath, "utf8");
    assertNoRemoteExec(label, content, failures);
    assertNoUnpinnedBetterSqliteInstall(label, content, failures);
  }

  const sbom = buildSbom(root);
  for (const component of sbom.components) {
    if (!component.packageJsonFound && component.scope !== "transitive") {
      failures.push(`dependency package metadata missing: ${component.name}`);
    }
    const licenseCheck = validateLicenseExpression(component.license);
    if (!licenseCheck.ok) {
      failures.push(`dependency license invalid: ${component.name}: ${licenseCheck.reason}`);
    }
    const depPkgPath = dependencyPackageJson(root, component.name);
    if (existsSync(depPkgPath)) {
      const depPkg = readJson(depPkgPath);
      for (const scriptName of LIFECYCLE_SCRIPTS) {
        const script = depPkg.scripts?.[scriptName];
        if (typeof script === "string") {
          assertNoRemoteExec(`dependency ${component.name} ${scriptName}`, script, failures);
        }
      }
    }
  }

  if (process.env.CONTEXT_MODE_COPIED_THIRD_PARTY === "1" && !existsSync(join(root, "NOTICE"))) {
    failures.push("NOTICE required when CONTEXT_MODE_COPIED_THIRD_PARTY=1");
  }

  if (opts.writeSbomPath) {
    const out = resolve(root, opts.writeSbomPath);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  }

  return {
    ok: failures.length === 0,
    failures,
    sbom,
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write-sbom") {
      opts.writeSbomPath = argv[++i];
    }
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runSupplyChainChecks(process.cwd(), parseArgs(process.argv.slice(2)));
  if (!result.ok) {
    console.error("supply-chain-check failed:");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`supply-chain-check OK: ${result.sbom.components.length} dependencies scanned`);
}
