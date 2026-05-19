// ctx_batch_execute suite. Same commands + queries on both servers.

import type { Suite } from "../suite.js";

const commands = [
  { label: "git-status",   command: "git status --porcelain" },
  { label: "node-version", command: "node --version" },
  { label: "echo-test",    command: "echo 'comparison-fixture-line alpha bravo charlie'" },
];

const queries = [
  "alpha bravo",
  "node version",
  "git status",
  "comparison fixture",
  "echo line",
];

const suite: Suite = {
  name: "ctx-batch",
  scenarios: [
    { tool: "ctx_batch_execute", name: "three-cmd-five-q", args: { commands, queries } },
    {
      tool: "ctx_batch_execute",
      name: "single-cmd",
      args: {
        commands: [{ label: "platform", command: "node -e \"console.log(process.platform, process.arch)\"" }],
        queries: ["platform"],
      },
    },
  ],
};

export default suite;
