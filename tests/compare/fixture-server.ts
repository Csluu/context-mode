// Local HTTP fixture server. Serves canned content from tests/fixtures/ so
// ctx_fetch_and_index comparisons are deterministic (no live network).
//
// Routes:
//   GET /docs/react-useEffect    -> tests/fixtures/context7-react-docs.md
//   GET /docs/nextjs             -> tests/fixtures/context7-nextjs-docs.md
//   GET /docs/tailwind           -> tests/fixtures/context7-tailwind-docs.md
//   GET /docs/supabase           -> tests/fixtures/context7-supabase-edge.md
//   GET /json/api-response       -> tests/fixtures/api-response.json
//
// Usage:
//   import { startFixtureServer } from "./fixture-server.js";
//   const srv = await startFixtureServer();
//   try { /* use srv.url(...) */ } finally { srv.close(); }

import { readFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(__dirname, "..", "fixtures");

const routes: Record<string, { file: string; mime: string }> = {
  "/docs/react-useEffect": { file: "context7-react-docs.md",     mime: "text/markdown; charset=utf-8" },
  "/docs/nextjs":          { file: "context7-nextjs-docs.md",    mime: "text/markdown; charset=utf-8" },
  "/docs/tailwind":        { file: "context7-tailwind-docs.md",  mime: "text/markdown; charset=utf-8" },
  "/docs/supabase":        { file: "context7-supabase-edge.md",  mime: "text/markdown; charset=utf-8" },
  "/json/api-response":    { file: "api-response.json",          mime: "application/json; charset=utf-8" },
};

export interface FixtureServerHandle {
  port: number;
  url: (route: string) => string;
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServerHandle> {
  const server: Server = createServer((req, res) => {
    const url = req.url || "/";
    const route = routes[url];
    if (!route) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end(`no fixture for ${url}`);
      return;
    }
    const path = join(fixturesRoot, route.file);
    if (!existsSync(path)) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(`fixture file missing: ${route.file}`);
      return;
    }
    const body = readFileSync(path);
    res.statusCode = 200;
    res.setHeader("content-type", route.mime);
    res.setHeader("content-length", String(body.length));
    res.end(body);
  });
  await new Promise<void>((resolveFn, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveFn());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("fixture server failed to bind");
  const port = addr.port;
  return {
    port,
    url: (route: string) => `http://127.0.0.1:${port}${route}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const fixtureRouteNames = Object.keys(routes);
