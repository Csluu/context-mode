// Tier 3: BM25 ranking quality. Index a corpus with one rare term and many
// noise terms; ctx_search top-1 should rank the rare-term section first.

import type { Workflow } from "./index.js";

const corpus = `
const fs = require("node:fs");
const lines = [];
for (let i = 0; i < 80; i++) lines.push("noisy section " + i + " repeated words common common common");
lines.push("special unique section: zebrafish_indicator_xyz keyword RAREMARKER");
for (let i = 0; i < 30; i++) lines.push("more noise " + i + " filler tokens");
for (const l of lines) console.log(l);
`;

const wf: Workflow = {
  name: "bm25-vs-grep",
  description: "Index ~110-line corpus with one rare token. ctx_search ranking should put the rare-term line first.",
  forkOnly: true,
  steps: [
    {
      label: "index",
      tool: "ctx_execute",
      args: { language: "javascript", code: corpus, intent: "RAREMARKER zebrafish" },
      assert: (t) => t.length > 0,
    },
    {
      label: "search-rare",
      tool: "ctx_search",
      args: { queries: ["zebrafish_indicator_xyz RAREMARKER"] },
      // Oracle: response must contain the rare marker AND it should appear in
      // an early result (rough proxy: marker within first 500 chars of payload).
      assert: (t) => {
        if (!t.includes("RAREMARKER") && !t.includes("zebrafish_indicator_xyz")) return ["marker not present"];
        const earlyChunk = t.slice(0, 600);
        if (earlyChunk.includes("RAREMARKER") || earlyChunk.includes("zebrafish_indicator_xyz")) return [];
        return ["marker exists but not in top result chunk"];
      },
    },
  ],
};

export default wf;
