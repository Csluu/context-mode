// Generic suite runner. Usage:
//   npx tsx tests/compare/run.ts <suite-name>
// Where <suite-name> matches a file under tests/compare/tools/*.ts.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import {
  buildMeta, exitOnFailure, isolateEnv, logRow, preflight, runScenario,
  type Row, withClients, withForkOnly, writeReport,
} from "./lib.js";
import type { Suite } from "./suite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadSuite(name: string): Promise<Suite> {
  const path = resolve(__dirname, "tools", `${name}.ts`);
  if (!existsSync(path)) {
    console.error(`[compare] no suite at ${path}`);
    process.exit(2);
  }
  const mod = await import(pathToFileURL(path).href);
  const suite: Suite | undefined = mod.default;
  if (!suite || !Array.isArray(suite.scenarios)) {
    console.error(`[compare] ${name} default export is not a Suite`);
    process.exit(2);
  }
  return suite;
}

export async function runSuite(suite: Suite): Promise<Row[]> {
  if (suite.beforeAll) await suite.beforeAll.call(suite);
  const forkEnv = { ...isolateEnv(`${suite.name}-fork`), ...(suite.env || {}) };
  const upEnv = { ...isolateEnv(`${suite.name}-upstream`), ...(suite.env || {}) };
  let rows: Row[] = [];
  try {
    if (suite.forkOnly) {
      rows = await withForkOnly(forkEnv, async (fork) => {
        const out: Row[] = [];
        for (const s of suite.scenarios) {
          const row = await runScenario(fork, null, s);
          out.push(row);
          logRow(row);
        }
        return out;
      });
    } else {
      rows = await withClients(forkEnv, upEnv, async (fork, upstream) => {
        const out: Row[] = [];
        for (const s of suite.scenarios) {
          const row = await runScenario(fork, upstream, s);
          out.push(row);
          logRow(row);
        }
        return out;
      });
    }
  } finally {
    if (suite.afterAll) await suite.afterAll.call(suite);
  }
  return rows;
}

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: tsx tests/compare/run.ts <suite-name>");
    process.exit(2);
  }
  const suite = await loadSuite(name);
  preflight({ upstream: !suite.forkOnly });
  const rows = await runSuite(suite);
  const meta = buildMeta(suite.name);
  const { jsonPath, mdPath } = writeReport(suite.name, rows, meta);
  console.log(`[compare] wrote ${jsonPath}`);
  console.log(`[compare] wrote ${mdPath}`);
  exitOnFailure(rows);
}

main().catch((e) => { console.error(e); process.exit(1); });
