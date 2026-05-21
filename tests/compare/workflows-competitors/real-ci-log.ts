// Real-CI-log workflow — generates output that mimics real CI runners:
//   1. GitHub Actions-style annotations + grouping
//   2. npm test output with ~80 passing + 3 failing tests
//   3. tsc compile output with multiple errors
//   4. Webpack/Vite build output with progress + warnings
//
// All synthesized from real-world output patterns. Tests how each tool handles
// the specific structures (timestamps, ::group::, FAIL/PASS, file:line:col).

import type { CompetitorWorkflow } from "./types.js";

const GHA_LOG = `
const groups = [
  ['Setup', 12],
  ['Install dependencies', 45],
  ['Lint', 18],
  ['Type check', 22],
  ['Test', 60],
  ['Build', 25],
];
let line = 0;
const ts = () => new Date(Date.now() + (line++ * 1000)).toISOString();
for (const [name, count] of groups) {
  console.log('::group::' + name);
  console.log(ts() + ' [INFO] starting ' + name);
  for (let i = 0; i < count; i++) {
    console.log(ts() + ' [' + name + '] step ' + (i + 1) + '/' + count + ' processing widget-' + (i % 50));
  }
  if (name === 'Test') {
    console.log(ts() + ' FAIL src/auth.test.ts');
    console.log(ts() + '   ✕ should reject invalid token (15 ms)');
    console.log(ts() + '     Expected: 401');
    console.log(ts() + '     Received: 500');
    console.log(ts() + '     at Object.<anonymous> (src/auth.test.ts:42:18)');
    console.log(ts() + ' FAIL src/api/users.test.ts');
    console.log(ts() + '   ✕ POST /users handles malformed body (22 ms)');
    console.log(ts() + '     TypeError: Cannot read property "email" of undefined');
    console.log(ts() + ' Test Suites: 2 failed, 28 passed, 30 total');
    console.log(ts() + ' Tests:       3 failed, 142 passed, 145 total');
  }
  console.log('::endgroup::');
}
console.log(ts() + ' [WARN] deprecation: passing options as object is deprecated, use named args');
console.log(ts() + ' [ERROR] Pipeline failed: 2 test suites failed');
process.exit(1);
`.replace(/\n/g, " ");

const TSC_LOG = `
const errors = [
  ['src/server.ts', 142, 18, 'TS2304', "Cannot find name 'undeclaredVar'"],
  ['src/server.ts', 245, 7, 'TS2322', "Type 'string' is not assignable to type 'number'"],
  ['src/auth/middleware.ts', 88, 23, 'TS7006', "Parameter 'req' implicitly has an 'any' type"],
  ['src/auth/middleware.ts', 92, 14, 'TS2339', "Property 'session' does not exist on type 'Request'"],
  ['src/db/migrations.ts', 17, 5, 'TS2554', "Expected 2 arguments, but got 1"],
  ['src/utils/format.ts', 33, 9, 'TS2531', "Object is possibly 'null'"],
  ['src/utils/format.ts', 41, 12, 'TS2362', "The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type"],
];
for (const [file, line, col, code, msg] of errors) {
  console.log(file + '(' + line + ',' + col + '): error ' + code + ': ' + msg + '.');
}
console.log('Found ' + errors.length + ' errors in 4 files.');
process.exit(1);
`.replace(/\n/g, " ");

const WEBPACK_LOG = `
const phases = ['compilation', 'modules', 'chunks', 'assets', 'emit'];
let line = 0;
const tick = () => '[' + String(line++).padStart(4, '0') + ']';
console.log('webpack 5.94.0 compiled successfully in 24561 ms');
for (const phase of phases) {
  console.log(tick(), 'starting phase:', phase);
  for (let i = 0; i < 30; i++) {
    console.log(tick(), '[' + phase + ']', 'module ./src/components/Widget' + i + '.tsx', (Math.random() * 1000).toFixed(0) + 'ms');
  }
}
console.log('WARNING in ./src/components/Widget5.tsx');
console.log('  Module Warning (from ./node_modules/eslint-loader/dist/cjs.js):');
console.log('  /workspace/src/components/Widget5.tsx');
console.log('    42:1   warning  Missing return type on function  @typescript-eslint/explicit-function-return-type');
console.log('WARNING in ./src/utils/legacy.ts');
console.log('  Module not found: Error: Can\\'t resolve "lodash"');
console.log('asset main.js 248 KiB [emitted] [minimized]');
console.log('asset vendor.js 1.4 MiB [emitted] [minimized]');
console.log('asset main.css 32 KiB [emitted]');
console.log('webpack 5.94.0 compiled with 2 warnings in 24561 ms');
`.replace(/\n/g, " ");

const wf: CompetitorWorkflow = {
  name: "real-ci-log",
  description: "Synthesized real-CI output: GHA grouped + vitest failures + tsc errors + webpack progress.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "command", label: "gha-style-with-failures",
      command: `node -e ${JSON.stringify(GHA_LOG)} 2>&1 || true`,
      timeoutMs: 30_000,
      assert: (t) => /FAIL|::group::|test/i.test(t) || t.length > 200,
    },
    {
      kind: "command", label: "tsc-errors",
      command: `node -e ${JSON.stringify(TSC_LOG)} 2>&1 || true`,
      timeoutMs: 15_000,
      assert: (t) => /TS\d+|error|cannot/i.test(t) || t.length > 100,
    },
    {
      kind: "command", label: "webpack-build",
      command: `node -e ${JSON.stringify(WEBPACK_LOG)} 2>&1 || true`,
      timeoutMs: 15_000,
      assert: (t) => /webpack|compiled|warning/i.test(t) || t.length > 200,
    },
  ],
};

export default wf;
