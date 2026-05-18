import { describe, expect, it } from "vitest";

import { experimentalToolsEnabled, registerTool } from "../../src/tools/registry.js";
import type { ToolContext, ToolDefinition } from "../../src/tools/types.js";

function makeContext(names: string[]): ToolContext {
  return {
    server: {
      registerTool(name: string) {
        names.push(name);
      },
    } as ToolContext["server"],
    pluginRoot: process.cwd(),
    getSessionDir: () => process.cwd(),
    trackResponse: (_tool, response) => response,
  };
}

function def(name: string, experimental = false): ToolDefinition<Record<string, never>, { content: [] }> {
  return {
    name,
    experimental,
    config: {
      title: name,
      description: name,
      inputSchema: {},
    },
    handler: () => ({ content: [] }),
  };
}

describe("tool registry experimental gating", () => {
  it("hides experimental tools unless CTX_MODE_EXPERIMENTAL is enabled", () => {
    const previousCtx = process.env.CTX_MODE_EXPERIMENTAL;
    const previousContext = process.env.CONTEXT_MODE_EXPERIMENTAL;
    delete process.env.CTX_MODE_EXPERIMENTAL;
    delete process.env.CONTEXT_MODE_EXPERIMENTAL;
    try {
      const names: string[] = [];
      const ctx = makeContext(names);

      registerTool(ctx, def("stable"));
      registerTool(ctx, def("experimental", true));

      expect(names).toEqual(["stable"]);
    } finally {
      if (previousCtx === undefined) delete process.env.CTX_MODE_EXPERIMENTAL;
      else process.env.CTX_MODE_EXPERIMENTAL = previousCtx;
      if (previousContext === undefined) delete process.env.CONTEXT_MODE_EXPERIMENTAL;
      else process.env.CONTEXT_MODE_EXPERIMENTAL = previousContext;
    }
  });

  it("registers experimental tools when the feature flag is enabled", () => {
    const previous = process.env.CTX_MODE_EXPERIMENTAL;
    process.env.CTX_MODE_EXPERIMENTAL = "1";
    try {
      expect(experimentalToolsEnabled()).toBe(true);
      const names: string[] = [];
      registerTool(makeContext(names), def("experimental", true));
      expect(names).toEqual(["experimental"]);
    } finally {
      if (previous === undefined) delete process.env.CTX_MODE_EXPERIMENTAL;
      else process.env.CTX_MODE_EXPERIMENTAL = previous;
    }
  });

  it("does not treat loose truthy strings as experimental opt-in", () => {
    expect(experimentalToolsEnabled({ CTX_MODE_EXPERIMENTAL: "yes" })).toBe(false);
    expect(experimentalToolsEnabled({ CTX_MODE_EXPERIMENTAL: "true" })).toBe(false);
    expect(experimentalToolsEnabled({ CTX_MODE_EXPERIMENTAL: "1" })).toBe(true);
  });
});
