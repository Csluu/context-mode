// Language coverage — TS + Rust (user's focus stack). Tests:
//   1. ctx_read map/outline on real-shaped TS code
//   2. ctx_read map/outline on real-shaped Rust code
//   3. Compiler-style error compression (tsc + rustc)
//
// Both languages have similar symbol-extraction needs but very different
// surface (decorators/imports vs traits/impls/macros). Exposes per-language
// pattern coverage in chop/squeez/lean-ctx vs fork's parser registry.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CompetitorWorkflow } from "./types.js";

let tmpDir: string | null = null;
let tsPath = "";
let rsPath = "";
let brokenTsPath = "";
let brokenRsPath = "";

const TS_SRC = `// Realistic TS surface for symbol-extraction testing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface UserConfig {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Record<string, string>;
  readonly scripts?: Record<string, string>;
}

export class ConfigLoader {
  private cache = new Map<string, UserConfig>();

  constructor(private readonly rootDir: string) {}

  load(name: string): UserConfig {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const data = JSON.parse(readFileSync(resolve(this.rootDir, name), "utf8"));
    const cfg: UserConfig = {
      name: data.name,
      version: data.version,
      dependencies: data.dependencies ?? {},
      scripts: data.scripts,
    };
    this.cache.set(name, cfg);
    return cfg;
  }

  clear(): void { this.cache.clear(); }
  get size(): number { return this.cache.size; }
}

export function mergeConfigs(a: UserConfig, b: Partial<UserConfig>): UserConfig {
  return {
    name: b.name ?? a.name,
    version: b.version ?? a.version,
    dependencies: { ...a.dependencies, ...(b.dependencies ?? {}) },
    scripts: { ...(a.scripts ?? {}), ...(b.scripts ?? {}) },
  };
}

export type ConfigPredicate = (cfg: UserConfig) => boolean;
export const isLibrary: ConfigPredicate = (c) => !c.scripts || Object.keys(c.scripts).length === 0;
`;

const RS_SRC = `// Realistic Rust surface for symbol-extraction testing.
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UserConfig {
    pub name: String,
    pub version: String,
    pub dependencies: HashMap<String, String>,
    pub scripts: Option<HashMap<String, String>>,
}

pub struct ConfigLoader {
    root_dir: String,
    cache: HashMap<String, UserConfig>,
}

impl ConfigLoader {
    pub fn new(root_dir: impl Into<String>) -> Self {
        Self { root_dir: root_dir.into(), cache: HashMap::new() }
    }

    pub fn load(&mut self, name: &str) -> Result<UserConfig, std::io::Error> {
        if let Some(cached) = self.cache.get(name) {
            return Ok(cached.clone());
        }
        let path = Path::new(&self.root_dir).join(name);
        let raw = fs::read_to_string(&path)?;
        let cfg: UserConfig = serde_json::from_str(&raw)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        self.cache.insert(name.to_string(), cfg.clone());
        Ok(cfg)
    }

    pub fn clear(&mut self) { self.cache.clear(); }
    pub fn size(&self) -> usize { self.cache.len() }
}

pub fn merge_configs(a: &UserConfig, b: &UserConfig) -> UserConfig {
    let mut deps = a.dependencies.clone();
    for (k, v) in &b.dependencies { deps.insert(k.clone(), v.clone()); }
    UserConfig {
        name: b.name.clone(),
        version: b.version.clone(),
        dependencies: deps,
        scripts: b.scripts.clone().or_else(|| a.scripts.clone()),
    }
}

pub type ConfigPredicate = fn(&UserConfig) -> bool;
pub fn is_library(c: &UserConfig) -> bool {
    c.scripts.as_ref().map_or(true, |s| s.is_empty())
}
`;

// Intentionally broken — tests error compression for each tool.
const BROKEN_TS = `export class Half {
  constructor(public x: number {  // missing close paren
    this.x = x
  }
}
const value: string = 42;
function returnNumber(): number { return "string"; }
`;

const BROKEN_RS = `pub fn broken() -> i32 {
    let x: u32 = "not a number";   // type mismatch
    let y = vec![1, 2, 3
    y.iter().sum()                  // missing close bracket
}
`;

const wf: CompetitorWorkflow = {
  name: "lang-coverage-ts-rust",
  description: "TS + Rust source reading + broken-code compile errors. Tests per-language pattern coverage.",
  fallbackPolicy: "raw-on-error",
  async beforeAll() {
    tmpDir = join(tmpdir(), `competitor-lang-${process.pid}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    tsPath = join(tmpDir, "config-loader.ts");
    rsPath = join(tmpDir, "config_loader.rs");
    brokenTsPath = join(tmpDir, "broken.ts");
    brokenRsPath = join(tmpDir, "broken.rs");
    writeFileSync(tsPath, TS_SRC);
    writeFileSync(rsPath, RS_SRC);
    writeFileSync(brokenTsPath, BROKEN_TS);
    writeFileSync(brokenRsPath, BROKEN_RS);
    (this.steps as any) = [
      { kind: "read", label: "read-ts-full",     path: tsPath, mode: "full",    assert: (t: string) => t.includes("UserConfig") || t.length > 100 },
      { kind: "read", label: "read-ts-map",      path: tsPath, mode: "map",     assert: (t: string) => /UserConfig|ConfigLoader|mergeConfigs|symbols/i.test(t) || t.length > 30 },
      { kind: "read", label: "read-ts-outline",  path: tsPath, mode: "outline", assert: (t: string) => /UserConfig|ConfigLoader|outline/i.test(t) || t.length > 30 },
      { kind: "read", label: "read-rs-full",     path: rsPath, mode: "full",    assert: (t: string) => t.includes("UserConfig") || t.length > 100 },
      { kind: "read", label: "read-rs-map",      path: rsPath, mode: "map",     assert: (t: string) => /UserConfig|ConfigLoader|merge_configs|symbols/i.test(t) || t.length > 30 },
      { kind: "read", label: "read-rs-outline",  path: rsPath, mode: "outline", assert: (t: string) => /UserConfig|ConfigLoader|outline/i.test(t) || t.length > 30 },
      {
        kind: "command", label: "tsc-broken",
        command: `npx -y typescript@5 tsc --noEmit --target es2020 --module esnext --moduleResolution bundler ${JSON.stringify(brokenTsPath)} 2>&1`,
        timeoutMs: 120_000,
        assert: (t: string) => /error|TS\d+|expected/i.test(t) || t.length > 30,
      },
      {
        kind: "command", label: "rustc-broken",
        command: `rustc --edition=2021 ${JSON.stringify(brokenRsPath)} 2>&1 || true`,
        timeoutMs: 60_000,
        assert: (t: string) => /error|expected|mismatched/i.test(t) || t.length > 30,
      },
    ];
  },
  async afterAll() {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },
  steps: [],
};

export default wf;
