import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runGuardFixtureSelfTest } from "../tools/guard.js";

function parseArgs(argv: readonly string[]): { jsonOut?: string } {
  let jsonOut: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json-out") jsonOut = argv[++i];
  }
  return { jsonOut };
}

const opts = parseArgs(process.argv.slice(2));
const report = runGuardFixtureSelfTest();
const text = `${JSON.stringify(report, null, 2)}\n`;

if (opts.jsonOut) {
  const out = resolve(opts.jsonOut);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, "utf8");
}

process.stdout.write(text);
process.exit(report.fixturePassed ? 0 : 1);
