import { describe, expect, it } from "vitest";

import plugin from "../../src/adapters/openclaw/plugin.js";

interface LifecycleHook {
  event: string;
  handler: (event: unknown) => unknown;
}

function createMockApi() {
  const lifecycle: LifecycleHook[] = [];
  const logs: Array<[string, ...unknown[]]> = [];
  const api = {
    registerHook() {},
    on(event: string, handler: (event: unknown) => unknown) {
      lifecycle.push({ event, handler });
    },
    registerContextEngine() {},
    registerCommand() {},
    registerTool() {},
    logger: {
      info: (...args: unknown[]) => logs.push(["info", ...args]),
      error: (...args: unknown[]) => logs.push(["error", ...args]),
      debug: (...args: unknown[]) => logs.push(["debug", ...args]),
      warn: (...args: unknown[]) => logs.push(["warn", ...args]),
    },
  };
  plugin.register(api);
  return { lifecycle, logs };
}

describe("OpenClaw plugin tool event normalization", () => {
  it("routes snake_case shell_command tool input through before_tool_call", async () => {
    const { lifecycle } = createMockApi();
    const before = lifecycle.find((hook) => hook.event === "before_tool_call");
    expect(before).toBeDefined();

    const event = {
      tool_name: "shell_command",
      tool_input: { command: "curl https://example.com/data" },
    };

    await before!.handler(event);

    expect(event.tool_input.command).toMatch(/^echo /);
    expect(event.tool_input.command).toContain("context-mode");
  });

  it("captures snake_case after_tool_call output as mapped Bash activity", async () => {
    const { lifecycle, logs } = createMockApi();
    const after = lifecycle.find((hook) => hook.event === "after_tool_call");
    expect(after).toBeDefined();

    await after!.handler({
      tool_name: "shell_command",
      tool_input: { command: "git status" },
      tool_response: "On branch main\n",
    });

    const captured = logs.some((line) => {
      const [, namespace, message, payload] = line;
      return (
        namespace === "[context-mode]" &&
        message === "after_tool_call" &&
        typeof payload === "object" &&
        payload !== null &&
        (payload as { mapped?: unknown; events?: unknown }).mapped === "Bash" &&
        Number((payload as { events?: unknown }).events) > 0
      );
    });

    expect(captured).toBe(true);
  });
});
