import { describe, expect, it, vi } from "vitest";

import { runWorkflowWithClients, workflowRowOk, type Workflow } from "./workflows/index.js";

function okCall(text: string) {
  return {
    ms: 1,
    bytes: Buffer.byteLength(text),
    result: { content: [{ type: "text", text }] },
    isError: false,
  };
}

function errorCall(text: string) {
  return {
    ms: 1,
    bytes: Buffer.byteLength(text),
    result: { isError: true, content: [{ type: "text", text }] },
    isError: true,
    errorText: text,
  };
}

describe("compare workflow gating", () => {
  it("stops dependent workflow steps and marks the workflow failed after a call error", async () => {
    const workflow: Workflow = {
      name: "failing-workflow",
      description: "workflow with a failing first step",
      steps: [
        { label: "first", tool: "ctx_first", args: {} },
        { label: "second", tool: "ctx_second", args: {} },
      ],
    };
    const fork = {
      call: vi.fn().mockRejectedValueOnce(new Error("first failed")),
    };
    const upstream = {
      call: vi.fn()
        .mockResolvedValueOnce(okCall("upstream first"))
        .mockResolvedValueOnce(okCall("upstream second")),
    };

    const row = await runWorkflowWithClients(workflow, fork as any, upstream as any);

    expect(row.fork.ok).toBe(false);
    expect(row.fork.steps).toHaveLength(1);
    expect(row.fork.steps[0].err).toContain("first failed");
    expect(fork.call).toHaveBeenCalledTimes(1);
    expect(row.upstream.ok).toBe(true);
    expect(workflowRowOk(row)).toBe(false);
  });

  it("treats MCP isError tool results as failed workflow steps", async () => {
    const workflow: Workflow = {
      name: "tool-error-workflow",
      description: "workflow with a tool-level error",
      steps: [
        { label: "first", tool: "ctx_first", args: {} },
        { label: "second", tool: "ctx_second", args: {} },
      ],
    };
    const fork = {
      call: vi.fn().mockResolvedValueOnce(errorCall("tool said no")),
    };
    const upstream = {
      call: vi.fn()
        .mockResolvedValueOnce(okCall("upstream first"))
        .mockResolvedValueOnce(okCall("upstream second")),
    };

    const row = await runWorkflowWithClients(workflow, fork as any, upstream as any);

    expect(row.fork.ok).toBe(false);
    expect(row.fork.steps).toHaveLength(1);
    expect(row.fork.steps[0].err).toContain("tool said no");
    expect(fork.call).toHaveBeenCalledTimes(1);
    expect(row.upstream.ok).toBe(true);
    expect(workflowRowOk(row)).toBe(false);
  });
});
