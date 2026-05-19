// ctx_fetch_and_index suite. Backed by a local HTTP fixture server so byte
// counts and timing are deterministic.

import { startFixtureServer, type FixtureServerHandle } from "../fixture-server.js";
import type { Suite } from "../suite.js";

let server: FixtureServerHandle | null = null;

const suite: Suite = {
  name: "ctx-fetch",
  env: { CONTEXT_MODE_FETCH_ALLOWLIST: "127.0.0.1" },
  async beforeAll() {
    server = await startFixtureServer();
    console.log(`[compare] fixture server on ${server.url("")}`);
    this.scenarios = [
      {
        tool: "ctx_fetch_and_index",
        name: "single-react",
        args: { url: server.url("/docs/react-useEffect"), source: "react-docs" },
      },
      {
        tool: "ctx_fetch_and_index",
        name: "single-nextjs",
        args: { url: server.url("/docs/nextjs"), source: "nextjs-docs" },
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
