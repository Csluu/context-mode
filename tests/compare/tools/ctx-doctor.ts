// ctx_doctor parity. Fork extends with extra diagnostic checks → most rows
// expected to be `equivalent` (fork is a superset of upstream output).

import type { Suite } from "../suite.js";

const suite: Suite = {
  name: "ctx-doctor",
  scenarios: [
    {
      tool: "ctx_doctor", name: "default", args: {},
      // Fork's ctx_doctor is a superset (adds hook + integration tier checks).
      // Divergence is the expected outcome — gracefully report jaccard but
      // don't fail.
      expectDivergence: true,
      canonicalize: (t) =>
        t.replace(/\bv\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?\b/g, "<VER>")
         .replace(/[A-Z]:\\[^\s"']+/g, "<WINPATH>"),
      assert: (t) => t.length > 50 ? [] : [`doctor output too short (${t.length}B)`],
    },
  ],
};

export default suite;
