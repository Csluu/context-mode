import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../src/routing/command-classifier.js";
import { routeCommand } from "../../src/routing/rewrite-registry.js";

describe("routing concurrency contracts", () => {
  function nextTurn<T>(fn: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(fn());
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  it("creates unique run ids for concurrent classifications", async () => {
    const commands = Array.from({ length: 200 }, (_, i) => `git diff -- src/file-${i}.ts`);

    const results = await Promise.all(commands.map((command) => nextTurn(() => classifyCommand(command))));
    const runIds = new Set(results.map((result) => result.runId));

    expect(runIds.size).toBe(results.length);
    expect(results.every((result) => result.segments.length === 1)).toBe(true);
  });

  it("does not share mutable route decision state across calls", async () => {
    const [first, second] = await Promise.all([
      nextTurn(() => routeCommand("pnpm test", { mode: "recommend", adapterCanRewrite: true })),
      nextTurn(() => routeCommand("git rebase -i HEAD~3", { mode: "rewrite", adapterCanRewrite: true })),
    ]);

    expect(first.selectedRule).toBe("node-test-generic");
    expect(first.decision).toBe("recommend");
    expect(second.decision).toBe("classify-only");
    expect(second.interactivity.requiresTty).toBe(true);
  });
});
