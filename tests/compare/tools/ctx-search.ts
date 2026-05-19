// ctx_search suite. Seeds both indices with identical content via
// ctx_batch_execute (setup hook), then runs matched queries.

import type { McpStdioClient } from "../runner.js";
import { requireToolOk } from "../lib.js";
import type { Suite } from "../suite.js";

const seedCommands = [
  { label: "corpus-alpha",   command: "echo 'alpha alpha bravo charlie delta echo'" },
  { label: "corpus-bravo",   command: "echo 'bravo bravo charlie delta echo foxtrot'" },
  { label: "corpus-charlie", command: "echo 'charlie charlie delta echo foxtrot golf'" },
];

async function seed(client: McpStdioClient): Promise<void> {
  requireToolOk(
    await client.call("ctx_batch_execute", { commands: seedCommands, queries: ["alpha"] }),
    "ctx-search seed",
  );
}

const suite: Suite = {
  name: "ctx-search",
  scenarios: [
    { tool: "ctx_search", name: "single-q-alpha", args: { queries: ["alpha"] }, setup: seed },
    { tool: "ctx_search", name: "multi-q",        args: { queries: ["alpha", "bravo", "charlie"] }, setup: seed },
    { tool: "ctx_search", name: "scoped-source",  args: { queries: ["delta"], source: "corpus-bravo" }, setup: seed },
    { tool: "ctx_search", name: "high-limit",     args: { queries: ["echo"], limit: 10 }, setup: seed },
  ],
};

export default suite;
