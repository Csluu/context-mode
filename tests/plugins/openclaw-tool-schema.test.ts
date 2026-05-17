import { describe, expect, it } from "vitest";
import { OPENCLAW_TOOL_DEFS } from "../../src/adapters/openclaw/mcp-tools.js";

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
  it.skip("declares items for every array schema", () => {
    const missingItems: string[] = [];

    for (const tool of OPENCLAW_TOOL_DEFS) {
      findArraySchemasMissingItems(tool.parameters, [tool.name, "parameters"], missingItems);
    }

    expect(missingItems).toEqual([]);
  });

  it.skip("declares concrete ctx_batch_execute array item schemas", () => {
    const batchTool = OPENCLAW_TOOL_DEFS.find((tool) => tool.name === "ctx_batch_execute");

    expect(batchTool?.parameters.properties.commands.items).toMatchObject({
      type: "object",
      required: ["label", "command"],
    });
    expect(batchTool?.parameters.properties.queries.items).toEqual({ type: "string" });
  });
});
