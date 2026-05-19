// Dim 4 — parsers value suite. Fork's src/parsers/registry.ts compresses
// noisy command output (vitest, pytest, rg, grep, git, generic-failure)
// into structured summaries. Upstream lacks this. Run is fork-only and
// records bytes_out; pair with parsers-baseline to measure delta.

import type { Suite } from "../suite.js";

const noisyVitestOutput = `
[vitest] running...
${Array.from({ length: 80 }, (_, i) => ` PASS  tests/example/case-${i}.test.ts > should do thing ${i}`).join("\n")}
 FAIL  tests/store.test.ts > ContentStore stores rows
  AssertionError: expected 1 to equal 0
 FAIL  tests/runtime.test.ts > detects bun runtime
  Error: missing runtime
${Array.from({ length: 40 }, (_, i) => ` PASS  tests/other/case-${i}.test.ts > thing ${i}`).join("\n")}
[vitest] 2 failed | 118 passed | 0 skipped
`;

const noisyTscOutput = `
${Array.from({ length: 50 }, (_, i) => `src/foo${i}.ts(${i + 10},${i % 30}): info TS6133: 'tmp' declared but never used.`).join("\n")}
src/server.ts(120,15): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
src/store.ts(48,9): error TS2322: Type 'undefined' is not assignable to type 'string'.
`;

const suite: Suite = {
  name: "value-parsers",
  forkOnly: true,
  scenarios: [
    {
      tool: "ctx_execute",
      name: "vitest-parser",
      args: { language: "javascript", code: `console.log(${JSON.stringify(noisyVitestOutput)});`, parser: "vitest" },
    },
    {
      tool: "ctx_execute",
      name: "generic-failure-parser",
      args: { language: "javascript", code: `console.log(${JSON.stringify(noisyTscOutput)});`, parser: "generic-failure" },
    },
    {
      tool: "ctx_execute",
      name: "no-parser-baseline",
      args: { language: "javascript", code: `console.log(${JSON.stringify(noisyVitestOutput)});` },
    },
  ],
};

export default suite;
