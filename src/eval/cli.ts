#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runCtxEval, type RunEvalOptions } from "./harness.js";

function parseArgs(argv: readonly string[]): RunEvalOptions & { jsonOut?: string } {
  let pack: RunEvalOptions["pack"] = "all";
  let fast = true;
  let jsonOut: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pack") {
      pack = argv[++i] as RunEvalOptions["pack"];
    } else if (arg === "--fast") {
      fast = true;
    } else if (arg === "--full") {
      fast = false;
    } else if (arg === "--json-out") {
      jsonOut = argv[++i];
    }
  }
  return { pack, fast, jsonOut };
}

const opts = parseArgs(process.argv.slice(2));
const report = runCtxEval(opts);
const text = `${JSON.stringify(report, null, 2)}\n`;
if (opts.jsonOut) {
  const out = resolve(opts.jsonOut);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, "utf8");
}
process.stdout.write(text);
process.exit(report.failed ? 1 : 0);
