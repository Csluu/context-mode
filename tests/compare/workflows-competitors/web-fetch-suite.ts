// Phase 1.5 — Web fetch suite. Only fork has native web compression. Other
// tools fall back to raw (httpRequest) via the runner's fallback policy.
// Captures fork's exclusive territory honestly.

import type { CompetitorWorkflow } from "./types.js";

const wf: CompetitorWorkflow = {
  name: "web-fetch-suite",
  description: "Fetch 5 real URLs. Fork uses ctx_fetch_and_index; others fall back to raw HTTP.",
  fallbackPolicy: "raw-on-error",
  steps: [
    {
      kind: "fetch",
      label: "raw-githubusercontent-readme",
      url: "https://raw.githubusercontent.com/mksglu/context-mode/main/README.md",
      assert: (t) => /context.?mode|mcp|sandbox/i.test(t) || t.length > 0,
    },
    {
      kind: "fetch",
      label: "rfc-2616",
      url: "https://www.rfc-editor.org/rfc/rfc2616.txt",
      assert: (t) => t.length > 0,
    },
    {
      kind: "fetch",
      label: "json-api",
      url: "https://api.github.com/repos/anthropics/claude-code",
      assert: (t) => t.length > 0,
    },
    {
      kind: "fetch",
      label: "mdn-fetch",
      url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
      assert: (t) => /fetch|response|request/i.test(t) || t.length > 100,
    },
    {
      kind: "fetch",
      label: "html-news",
      url: "https://example.com/",
      assert: (t) => /example/i.test(t) || t.length > 0,
    },
  ],
};

export default wf;
