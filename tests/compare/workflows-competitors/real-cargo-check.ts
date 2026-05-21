// Phase 1.5 — Real cargo check (optional, skipped if cargo missing).
// Polyglot coverage — Rust ecosystem output style.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { CompetitorWorkflow } from "./types.js";

let tmpDir: string | null = null;

const FIXTURE_CARGO = `[package]
name = "competitor-bench-fixture"
version = "0.0.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`;
const FIXTURE_RS = `use serde::Serialize;

#[derive(Serialize)]
struct X { v: i32 }

fn main() {
  let x = X { v: 7 };
  println!("{}", serde_json::to_string(&x).unwrap());
}
`;

function cargoAvailable(): boolean {
  try {
    const r = spawnSync("cargo", ["--version"], { encoding: "utf8", timeout: 4000 });
    return r.status === 0;
  } catch { return false; }
}

const wf: CompetitorWorkflow = {
  name: "real-cargo-check",
  description: "cargo check on a 2-dep Rust fixture. Skipped if cargo not on PATH.",
  fallbackPolicy: "raw-on-error",
  async beforeAll() {
    if (!cargoAvailable()) {
      // Empty steps array means the workflow runs but produces no rows.
      (this.steps as any) = [];
      return;
    }
    tmpDir = join(tmpdir(), `competitor-cargo-${process.pid}-${Date.now()}`);
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "Cargo.toml"), FIXTURE_CARGO);
    writeFileSync(join(tmpDir, "src", "main.rs"), FIXTURE_RS);
    (this.steps as any) = [
      {
        kind: "command",
        label: "cargo-check",
        command: `cd ${JSON.stringify(tmpDir)} && cargo check --offline --message-format=short 2>&1 || cargo check --message-format=short 2>&1`,
        timeoutMs: 240_000,
        assert: (t: string) => /finished|warning|error|Compiling|cargo/i.test(t) || t.length > 30,
      },
    ];
  },
  async afterAll() {
    if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },
  steps: [],
};

export default wf;
