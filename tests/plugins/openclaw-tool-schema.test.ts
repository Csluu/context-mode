import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getOpenClawToolDefs, OPENCLAW_TOOL_DEFS } from "../../src/adapters/openclaw/mcp-tools.js";

function findArraySchemasMissingItems(value: unknown, path: string[], out: string[]) {
  if (!value || typeof value !== "object") return;

  const schema = value as { type?: unknown; items?: unknown };
  if (schema.type === "array" && schema.items === undefined) {
    out.push(path.join("."));
  }

  for (const [key, child] of Object.entries(value)) {
    findArraySchemasMissingItems(child, [...path, key], out);
  }
}

describe("OpenClaw tool schemas", () => {
  it("declares OpenClaw manifest contracts for default registered ctx_* tools", () => {
    const manifestPaths = [
      resolve(import.meta.dirname, "../../.openclaw-plugin/openclaw.plugin.json"),
      resolve(import.meta.dirname, "../../openclaw.plugin.json"),
    ];
    const names = getOpenClawToolDefs({}).map((tool) => tool.name).sort();

    for (const manifestPath of manifestPaths) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        activation?: { onStartup?: boolean; onCapabilities?: string[] };
        contracts?: { tools?: string[] };
      };
      expect(manifest.activation?.onStartup).toBe(true);
      expect(manifest.activation?.onCapabilities).toEqual(expect.arrayContaining(["tool", "hook"]));
      expect([...(manifest.contracts?.tools ?? [])].sort()).toEqual(names);
    }
  });

  it("declares items for every array schema", () => {
    const missingItems: string[] = [];

    for (const tool of OPENCLAW_TOOL_DEFS) {
      findArraySchemasMissingItems(tool.parameters, [tool.name, "parameters"], missingItems);
    }

    expect(missingItems).toEqual([]);
  });

  it("declares concrete ctx_batch_execute array item schemas", () => {
    const batchTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_batch_execute");

    expect(batchTool?.parameters.properties.commands.items).toMatchObject({
      type: "object",
      required: ["label", "command"],
    });
    expect(batchTool?.parameters.properties.queries.items).toEqual({ type: "string" });
    expect(batchTool?.parameters.properties).toMatchObject({
      projectDir: { type: "string" },
      cwd: { type: "string" },
      timeout: { type: "number" },
      concurrency: { type: "number" },
    });
  });

  it("declares concrete ctx_fetch_and_index request item schemas", () => {
    const fetchTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_fetch_and_index");

    expect(fetchTool?.parameters.required).toBeUndefined();
    expect(fetchTool?.parameters.properties).toMatchObject({
      projectDir: { type: "string" },
    });
    expect(fetchTool?.parameters.properties.requests.items).toMatchObject({
      type: "object",
      required: ["url"],
    });
  });

  it("keeps OpenClaw ctx_stats/gain/discover schemas aligned with MCP inputs", () => {
    const statsTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_stats");
    expect(statsTool?.parameters.properties).toMatchObject({
      scope: { type: "string" },
      session: { type: "string" },
      listSessions: { type: "boolean" },
      limit: { type: "number" },
    });

    const gainTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_gain");
    expect(gainTool?.parameters.properties).toMatchObject({
      json: { type: "boolean" },
      session: { type: "string" },
      lastDays: { type: "number" },
    });

    const discoverTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_discover");
    expect(discoverTool?.parameters.properties).toMatchObject({
      json: { type: "boolean" },
      minBytes: { type: "number" },
      session: { type: "string" },
      lastDays: { type: "number" },
    });
  });

  it("keeps OpenClaw ctx_execute/fetch_run schemas aligned with cwd and preview inputs", () => {
    const executeTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_execute");
    expect(executeTool?.parameters.properties).toMatchObject({
      language: { type: "string" },
      code: { type: "string" },
      intent: { type: "string" },
      parser: { type: "string" },
      projectDir: { type: "string" },
      cwd: { type: "string" },
    });

    const fetchRunTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_fetch_run");
    expect(fetchRunTool?.parameters.properties).toMatchObject({
      runId: { type: "string" },
      projectDir: { type: "string" },
      raw: { type: "boolean" },
      maxBytes: { type: "number" },
      preview: { type: "string" },
    });

    const indexTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_index");
    expect(indexTool?.parameters.required).toBeUndefined();
    expect(indexTool?.parameters.properties).toMatchObject({
      content: { type: "string" },
      path: { type: "string" },
      source: { type: "string" },
      projectDir: { type: "string" },
    });
  });

  it("keeps OpenClaw stable tool schemas aligned with MCP optional inputs", () => {
    const readTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_read");
    expect(readTool?.parameters.properties).toMatchObject({
      compact: { type: "boolean" },
    });

    const codeTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_code");
    expect(codeTool?.parameters.properties).toMatchObject({
      action: { type: "string" },
      projectDir: { type: "string" },
      query: { type: "string" },
      symbol: { type: "string" },
      file: { type: "string" },
      kind: { type: "string" },
      budgetBytes: { type: "number" },
    });

    const diffTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_diff");
    expect(diffTool?.parameters.properties).toMatchObject({
      summary: { type: "boolean" },
    });

    const executeFileTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_execute_file");
    expect(executeFileTool?.parameters.properties).toMatchObject({
      projectDir: { type: "string" },
      timeout: { type: "number" },
      intent: { type: "string" },
    });

    const searchTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_search");
    expect(searchTool?.parameters.properties).toMatchObject({
      projectDir: { type: "string" },
      limit: { type: "number" },
      contentType: { type: "string" },
    });

    const routeTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_route");
    expect(routeTool?.parameters.properties).toMatchObject({
      adapterCanRewrite: { type: "boolean" },
    });
    expect(routeTool?.parameters.properties.explain.description).toContain("compact JSON");

    const doctorTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_doctor");
    expect(doctorTool?.parameters.properties).toMatchObject({
      json: { type: "boolean" },
    });

    const purgeTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_purge");
    expect(purgeTool?.parameters.properties).toMatchObject({
      confirm: { type: "boolean" },
      dryRun: { type: "boolean" },
      sessionId: { type: "string" },
      scope: { type: "string" },
    });

    const insightTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_insight");
    expect(insightTool?.parameters.properties).toMatchObject({
      port: { type: "number" },
      sessionDir: { type: "string" },
      contentDir: { type: "string" },
      insightSessionDir: { type: "string" },
      insightContentDir: { type: "string" },
    });
  });

  it("makes OpenClaw bridge stubs explicit in descriptions and runtime output", async () => {
    for (const tool of OPENCLAW_TOOL_DEFS) {
      expect(tool.description).toMatch(/^Bridge stub; does not execute\./);
    }

    const indexTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_index");
    const result = await indexTool?.execute("test", { path: "README.md", source: "readme" });

    expect(result?.isError).toBeUndefined();
    expect(result?.content[0].text).toContain("OpenClaw bridge stub, not the real Context Mode MCP tool");
  });

  it("marks OpenClaw bridge handler failures as MCP errors", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../src/adapters/openclaw/mcp-tools.ts"), "utf8");

    expect(source).toContain("isError: true");
  });
});
