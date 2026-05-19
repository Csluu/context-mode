import { describe, expect, it, vi } from "vitest";

import { requireToolOk, runScenario } from "./lib.js";

function okCall(text: string) {
  return {
    ms: 1,
    payloadBytes: Buffer.byteLength(text),
    result: { content: [{ type: "text", text }] },
    isError: false,
  };
}

function errorCall(text: string) {
  return {
    ms: 1,
    payloadBytes: Buffer.byteLength(text),
    result: { isError: true, content: [{ type: "text", text }] },
    isError: true,
    errorText: text,
  };
}

describe("compare runner iteration accounting", () => {
  it("marks a side failed when any measured iteration fails", async () => {
    const fork = {
      call: vi.fn()
        .mockResolvedValueOnce(okCall("same"))
        .mockRejectedValueOnce(new Error("intermittent failure")),
    };

    const row = await runScenario(fork as any, null, {
      name: "flaky",
      tool: "ctx_test",
      args: {},
      iterations: 2,
      warmups: 0,
    });

    expect(row.fork.ok).toBe(false);
    expect(row.fork.attempts).toBe(2);
    expect(row.fork.successes).toBe(1);
    expect(row.fork.failures).toBe(1);
    expect(row.parity).toBe("error");
    expect(row.fork.err).toContain("intermittent failure");
  });

  it("marks MCP isError tool results as failed calls", async () => {
    const fork = {
      call: vi.fn().mockResolvedValueOnce(errorCall("tool-level failure")),
    };

    const row = await runScenario(fork as any, null, {
      name: "tool-error",
      tool: "ctx_test",
      args: {},
      iterations: 1,
      warmups: 0,
    });

    expect(row.fork.ok).toBe(false);
    expect(row.fork.successes).toBe(0);
    expect(row.fork.failures).toBe(1);
    expect(row.parity).toBe("error");
    expect(row.fork.err).toContain("tool-level failure");
  });

  it("marks scenario setup exceptions as failed before measured calls", async () => {
    const fork = { call: vi.fn() };

    const row = await runScenario(fork as any, null, {
      name: "setup-throws",
      tool: "ctx_test",
      args: {},
      iterations: 1,
      warmups: 0,
      setup: async () => { throw new Error("seed failed"); },
    });

    expect(row.fork.ok).toBe(false);
    expect(row.fork.failures).toBe(1);
    expect(row.parity).toBe("error");
    expect(row.fork.err).toContain("seed failed");
    expect(fork.call).not.toHaveBeenCalled();
  });

  it("marks scenario setup MCP isError results as failed", async () => {
    const fork = {
      call: vi.fn().mockResolvedValueOnce(errorCall("seed tool failed")),
    };

    const row = await runScenario(fork as any, null, {
      name: "setup-tool-error",
      tool: "ctx_test",
      args: {},
      iterations: 1,
      warmups: 0,
      setup: async (client: any) => {
        requireToolOk(await client.call("ctx_seed", {}), "seed");
      },
    });

    expect(row.fork.ok).toBe(false);
    expect(row.fork.failures).toBe(1);
    expect(row.parity).toBe("error");
    expect(row.fork.err).toContain("seed tool failed");
    expect(fork.call).toHaveBeenCalledTimes(1);
  });
});
