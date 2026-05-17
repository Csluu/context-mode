#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const checks = [
  [process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]],
  [process.execPath, ["scripts/assert-asymmetric-drift.mjs"]],
];

for (const [cmd, args] of checks) {
  const label = [cmd, ...args].join(" ");
  console.error(`[pre-commit] ${label}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    console.error(`[pre-commit] failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}
