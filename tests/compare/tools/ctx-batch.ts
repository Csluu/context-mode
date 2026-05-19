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
    {
      tool: "ctx_batch_execute", name: "three-cmd-five-q", args: { commands, queries },
      assert: (t) => {
        const issues: string[] = [];
        if (!t.toLowerCase().includes("alpha")) issues.push(`no 'alpha' (echo output)`);
        if (!/comparison-fixture-line/i.test(t)) issues.push(`no echo content`);
        return issues;
      },
    },
    {
      tool: "ctx_batch_execute",
      name: "single-cmd",
      args: {
        commands: [{ label: "platform", command: "node -e \"console.log(process.platform, process.arch)\"" }],
        queries: ["platform"],
      },
      assert: (t) => /win32|linux|darwin/i.test(t) ? [] : [`no platform string in result`],
    },
  ],
};

export default suite;
