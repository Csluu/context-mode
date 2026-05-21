// ctx_execute suite. Matched code+language on both servers.

import type { Suite } from "../suite.js";

const jsHello = `console.log("hello from ctx_execute");`;
const jsCount = `
const arr = Array.from({ length: 1000 }, (_, i) => i);
console.log("sum=" + arr.reduce((a, b) => a + b, 0));
`;
const jsBigOutput = `
for (let i = 0; i < 200; i++) {
  console.log("line " + i + " ".repeat(50) + "filler-token-" + i);
}
console.log("ERROR: synthetic failure marker");
`;

// Fork appends sidecar references when output is large + indexed:
//   "Full redacted output saved: .context-mode/runs/.../raw.log"
//   "Use ctx_fetch_run({ ... })"
// Upstream lacks the sidecar layer. Strip those lines for fair parity.
const stripSidecar = (t: string): string =>
  t.split("\n")
    .filter((l) => !/Full redacted output saved|\.context-mode[\\/]runs|ctx_fetch_run\(/.test(l))
    .join("\n");

const suite: Suite = {
  name: "ctx-execute",
  scenarios: [
    { tool: "ctx_execute", name: "js-hello",   args: { language: "javascript", code: jsHello } },
    { tool: "ctx_execute", name: "js-sum",     args: { language: "javascript", code: jsCount } },
    { tool: "ctx_execute", name: "shell-echo", args: { language: "shell", code: "echo compare-hello" } },
    {
      tool: "ctx_execute", name: "js-intent-large",
      args: { language: "javascript", code: jsBigOutput, intent: "ERROR markers" },
      canonicalize: stripSidecar,
    },
  ],
};

export default suite;
