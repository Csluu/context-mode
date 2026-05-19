import { describe, expect, test } from "vitest";
import {
  needsHookNormalization,
  normalizeHooksJson,
  normalizePluginJson,
} from "../../hooks/normalize-hooks.mjs";

const currentPluginRoot = "C:/cache/context-mode/context-mode/1.0.140";

describe("cache-version hook normalization", () => {
  test("detects hook commands pointing at an older cache install", () => {
    const content = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  '"C:/node/node.exe" "C:/cache/context-mode/context-mode/1.0.139/hooks/sessionstart.mjs"',
              },
            ],
          },
        ],
      },
    });

    expect(needsHookNormalization(content, currentPluginRoot)).toBe(true);
  });

  test("rewrites stale hook command cache-version segments", () => {
    const input = JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command:
                    '"C:/node/node.exe" "C:/cache/context-mode/context-mode/1.0.139/hooks/sessionstart.mjs"',
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    );

    const out = normalizeHooksJson(input, "C:/node/node.exe", currentPluginRoot);
    const parsed = JSON.parse(out);
    const cmd = parsed.hooks.SessionStart[0].hooks[0].command;

    expect(cmd).toContain(
      "C:/cache/context-mode/context-mode/1.0.140/hooks/sessionstart.mjs",
    );
    expect(cmd).not.toContain("1.0.139");
  });

  test("rewrites stale plugin mcpServer cache-version args", () => {
    const input = JSON.stringify(
      {
        name: "context-mode",
        mcpServers: {
          "context-mode": {
            command: "node",
            args: ["C:/cache/context-mode/context-mode/1.0.139/start.mjs"],
          },
        },
      },
      null,
      2,
    );

    const out = normalizePluginJson(input, "C:/node/node.exe", currentPluginRoot);
    const parsed = JSON.parse(out);

    expect(parsed.mcpServers["context-mode"].command).toBe("C:/node/node.exe");
    expect(parsed.mcpServers["context-mode"].args).toEqual([
      "C:/cache/context-mode/context-mode/1.0.140/start.mjs",
    ]);
  });
});
