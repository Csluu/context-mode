// Raw baseline: run command directly via bash, count all bytes.
// fetchUrl uses node:https for a fair raw download. search wraps `grep -rn` over
// the indexed source directory (no FTS — just grep, the honest raw analogue).

import { readFileSync, statSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import {
  type CompetitorAdapter,
  type CompetitorRunResult,
  type FetchUrlOpts,
  type IndexOpts,
  type ReadFileOpts,
  type RunCommandOpts,
  type SearchOpts,
  estimateTokens,
  runViaBash,
  spawnToRunResult,
} from "./lib.js";

function clipKeep(text: string): string { return text.slice(0, 6000); }

export const rawAdapter: CompetitorAdapter = {
  id: "raw",
  description: "Raw shell + cat baseline. No compression.",
  async detect() {
    return { available: true, version: "n/a" };
  },
  async runCommand(cmd: string, opts: RunCommandOpts = {}): Promise<CompetitorRunResult> {
    const spawn = runViaBash(cmd, opts);
    return spawnToRunResult("raw", cmd.slice(0, 40), spawn, opts.keepOutput);
  },
  async readFile(path: string, opts: ReadFileOpts = {}): Promise<CompetitorRunResult> {
    const started = Date.now();
    let bytes = 0;
    let text = "";
    try {
      if (opts.mode === "slice" && opts.start !== undefined && opts.end !== undefined) {
        const lines = readFileSync(path, "utf8").split(/\r?\n/);
        const chunk = lines.slice(opts.start - 1, opts.end).join("\n");
        bytes = Buffer.byteLength(chunk, "utf8");
        text = chunk;
      } else {
        const buf = readFileSync(path);
        bytes = buf.length;
        text = opts.keepOutput ? buf.toString("utf8") : "";
      }
    } catch (err) {
      return {
        tool: "raw",
        stepLabel: `read:${path}`,
        ms: Date.now() - started,
        bytes: 0,
        tokens: 0,
        ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
    return {
      tool: "raw",
      stepLabel: `read:${path}`,
      ms: Date.now() - started,
      bytes,
      tokens: estimateTokens(bytes),
      ok: true,
      output: opts.keepOutput ? clipKeep(text) : undefined,
    };
  },
  async fetchUrl(url: string, opts: FetchUrlOpts = {}): Promise<CompetitorRunResult> {
    const started = Date.now();
    try {
      const isHttps = url.startsWith("https:");
      const fetcher = isHttps ? httpsRequest : httpRequest;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const req = fetcher(url, (res) => {
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve());
          res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(30_000, () => { req.destroy(new Error("fetch timeout")); });
        req.end();
      });
      const buf = Buffer.concat(chunks);
      return {
        tool: "raw",
        stepLabel: `fetch:${url.slice(0, 40)}`,
        ms: Date.now() - started,
        bytes: buf.length,
        tokens: estimateTokens(buf.length),
        ok: true,
        output: opts.keepOutput ? clipKeep(buf.toString("utf8")) : undefined,
      };
    } catch (err) {
      return {
        tool: "raw",
        stepLabel: `fetch:${url.slice(0, 40)}`,
        ms: Date.now() - started,
        bytes: 0,
        tokens: 0,
        ok: false,
        errorReason: err instanceof Error ? err.message : String(err),
      };
    }
  },
  async index(opts: IndexOpts): Promise<CompetitorRunResult> {
    // Raw "index" = ls -laR of the directory (or running the command). Pure
    // overhead with no actual indexing benefit; baseline for what indexing
    // would cost without the FTS5 payoff.
    const started = Date.now();
    if (opts.command) {
      const r = runViaBash(opts.command, { timeoutMs: opts.timeoutMs ?? 30_000 });
      return spawnToRunResult("raw", `index:${opts.source}`, r, opts.keepOutput);
    }
    if (opts.path) {
      const r = runViaBash(`ls -laR ${JSON.stringify(opts.path)} 2>/dev/null | head -200`, { timeoutMs: 15_000 });
      return spawnToRunResult("raw", `index:${opts.source}`, r, opts.keepOutput);
    }
    return {
      tool: "raw", stepLabel: `index:${opts.source}`,
      ms: Date.now() - started, bytes: 0, tokens: 0, ok: false,
      errorReason: "index step requires path or command",
    };
  },
  async search(query: string, opts: SearchOpts = {}): Promise<CompetitorRunResult> {
    // Raw equivalent: grep -rEn for any word in the query across the corpus.
    // FTS5 tools search multi-word as OR by default — mirror that with -E and
    // pipe-joined alternation. Falls back to the whole query as a literal if
    // alternation produces nothing.
    const target = opts.source ?? ".";
    const words = query.split(/\s+/).filter((w) => w.length >= 3 && /^[\w.-]+$/.test(w));
    const alt = words.length > 0 ? words.join("|") : query;
    const cmd = `grep -rEn ${JSON.stringify(alt)} ${JSON.stringify(target)} 2>/dev/null | head -50`;
    const spawn = runViaBash(cmd, { timeoutMs: 30_000 });
    return spawnToRunResult("raw", `search:${query.slice(0, 30)}`, spawn, opts.keepOutput);
  },
};
