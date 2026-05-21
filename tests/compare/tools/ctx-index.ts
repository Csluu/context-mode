// ctx_index parity. Indexes a string under a labeled source so subsequent
// ctx_search can find it. Compares index acknowledgement shape.

import type { Suite } from "../suite.js";

const corpus = `
alpha bravo charlie
delta echo foxtrot
golf hotel india
`;

const suite: Suite = {
  name: "ctx-index",
  scenarios: [
    {
      tool: "ctx_index", name: "index-string",
      args: { content: corpus, source: "compare-ctx-index-corpus" },
      assert: (t) => t.length > 0 ? [] : [`index ack empty`],
    },
  ],
};

export default suite;
