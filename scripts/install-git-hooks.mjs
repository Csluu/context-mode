#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";

try {
  chmodSync(".githooks/pre-commit", 0o755);
} catch {
  // Windows may ignore POSIX mode bits; Git for Windows still honors hooksPath.
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.error("Configured git core.hooksPath=.githooks");
