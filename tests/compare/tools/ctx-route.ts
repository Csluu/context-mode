// ctx_route suite. Fork adds command-classifier + rewrite-registry, so most
// rows expected to be `equivalent` (superset) rather than `match`.

import type { Suite } from "../suite.js";

const suite: Suite = {
  name: "ctx-route",
  scenarios: [
    { tool: "ctx_route", name: "git-diff",       args: { command: "git diff main", explain: true } },
    { tool: "ctx_route", name: "npm-test",       args: { command: "npm test", explain: true } },
    { tool: "ctx_route", name: "curl-url",       args: { command: "curl https://example.com", explain: true } },
    { tool: "ctx_route", name: "cat-large",      args: { command: "cat package-lock.json", explain: true } },
    { tool: "ctx_route", name: "ls-simple",      args: { command: "ls -la", explain: true } },
    { tool: "ctx_route", name: "grep-recursive", args: { command: "grep -r TODO src/", explain: true } },
    { tool: "ctx_route", name: "git-log-noisy",  args: { command: "git log --oneline -1000", explain: true } },
    { tool: "ctx_route", name: "rm-rf-build",    args: { command: "rm -rf build", explain: true } },
  ],
};

export default suite;
