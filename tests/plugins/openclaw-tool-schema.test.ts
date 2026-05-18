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
  });

  it("declares concrete ctx_fetch_and_index request item schemas", () => {
    const fetchTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_fetch_and_index");

    expect(fetchTool?.parameters.required).toBeUndefined();
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
});
