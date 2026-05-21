// ctx_fetch_and_index suite. Backed by a local HTTP fixture server so byte
// counts and timing are deterministic.

import { startFixtureServer, type FixtureServerHandle } from "../fixture-server.js";
import type { Suite } from "../suite.js";

let server: FixtureServerHandle | null = null;

const suite: Suite = {
  name: "ctx-fetch",
  env: {
    CONTEXT_MODE_FETCH_ALLOWLIST: "127.0.0.1",
    // Fork rejects private IPs by default; opt in for the local fixture server.
    CTX_FETCH_ALLOW_PRIVATE: "1",
  },
  async beforeAll() {
    server = await startFixtureServer();
    console.log(`[compare] fixture server on ${server.url("")}`);
    // Fork hashes URL into source ID: "react-docs#url-130532b60db7"
    // Upstream concatenates URL:       "react-docs::http://127.0.0.1:.../"
    // Same data, different identifier format. Canonicalize both → <SRC>.
    // Fork also adds "host<=N" concurrency note; strip.
    const canonSource = (t: string): string =>
      t.replace(/([a-z-]+(?:-docs)?)#url-[0-9a-f]+/gi, "$1<SRC>")
       .replace(/([a-z-]+(?:-docs)?)::http:\/\/[^\s"*<]+/gi, "$1<SRC>")
       // Fork batch summary: "c=N host<=M." vs upstream "c=N."
       .replace(/\s+host<=\d+/g, "");
    this.scenarios = [
      {
        tool: "ctx_fetch_and_index",
        name: "single-react",
        args: { url: server.url("/docs/react-useEffect"), source: "react-docs" },
        canonicalize: canonSource,
      },
      {
        tool: "ctx_fetch_and_index",
        name: "single-nextjs",
        args: { url: server.url("/docs/nextjs"), source: "nextjs-docs" },
        canonicalize: canonSource,
      },
      {
        tool: "ctx_fetch_and_index",
        name: "batch-four",
        args: {
          requests: [
            { url: server.url("/docs/react-useEffect"), source: "react" },
            { url: server.url("/docs/nextjs"),          source: "next" },
            { url: server.url("/docs/tailwind"),        source: "tw" },
            { url: server.url("/docs/supabase"),        source: "supa" },
          ],
          concurrency: 4,
        },
        canonicalize: canonSource,
      },
    ];
  },
  async afterAll() {
    if (server) await server.close();
    server = null;
  },
  scenarios: [],
};

export default suite;
