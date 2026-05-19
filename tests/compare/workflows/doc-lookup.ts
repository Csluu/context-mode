// Workflow: research an API via canned docs.
//   fetch_and_index(react useEffect) + fetch_and_index(nextjs)
//   → search(specific concept) → search(usage example)

import { startFixtureServer, type FixtureServerHandle } from "../fixture-server.js";
import type { Workflow } from "./index.js";

let server: FixtureServerHandle | null = null;

const wf: Workflow = {
  name: "doc-lookup",
  description: "Fetch React + Next docs from local fixture server, then search across both for a specific concept.",
  env: { CONTEXT_MODE_FETCH_ALLOWLIST: "127.0.0.1" },
  async beforeAll() {
    server = await startFixtureServer();
    this.steps = [
      {
        label: "fetch-react",
        tool: "ctx_fetch_and_index",
        args: { url: server.url("/docs/react-useEffect"), source: "react-docs" },
      },
      {
        label: "fetch-nextjs",
        tool: "ctx_fetch_and_index",
        args: { url: server.url("/docs/nextjs"), source: "nextjs-docs" },
      },
      {
        label: "search-useEffect",
        tool: "ctx_search",
        args: { queries: ["useEffect dependencies"] },
      },
      {
        label: "search-server-component",
        tool: "ctx_search",
        args: { queries: ["server component"] },
      },
    ];
  },
  async afterAll() {
    if (server) await server.close();
    server = null;
  },
  steps: [],
};

export default wf;
