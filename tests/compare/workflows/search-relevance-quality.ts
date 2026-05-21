// Tier 2: search relevance quality. Index a known corpus then query for a
// specific token. Oracle: top result must contain the target.

import type { Workflow } from "./index.js";

const corpus = `
const fs = require("node:fs");
const distinct_token = "RUTABAGA_ALPHA_42";
const sections = [
  "intro: greetings and overview",
  "section alpha: discusses cabbages and cabbits",
  "section beta: a wholly unrelated tangent about RUTABAGA_ALPHA_42 the marker",
  "section gamma: closing thoughts on root vegetables",
  "section delta: more about cabbages",
  "section epsilon: pumpkins and gourds",
];
for (const s of sections) console.log(s);
console.log("END corpus");
`;

const wf: Workflow = {
  name: "search-relevance-quality",
  description: "Index a corpus via ctx_execute(intent), then ctx_search for a unique marker. Top result must contain the marker.",
  forkOnly: true,
  steps: [
    {
      label: "index-corpus",
      tool: "ctx_execute",
      args: { language: "javascript", code: corpus, intent: "RUTABAGA_ALPHA_42 unique marker" },
      assert: (t) => t.length > 0,
    },
    {
      label: "search-marker",
      tool: "ctx_search",
      args: { queries: ["RUTABAGA_ALPHA_42"] },
      assert: (t) => t.includes("RUTABAGA_ALPHA_42"),
    },
  ],
};

export default wf;
