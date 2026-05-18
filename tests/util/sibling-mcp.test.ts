import { describe, expect, it } from "vitest";

import { startupSiblingSweep } from "../../src/util/sibling-mcp.js";

describe("startupSiblingSweep", () => {
  it("is opt-in rather than default-on", async () => {
    await expect(startupSiblingSweep({})).resolves.toEqual({
      terminatedBySigterm: 0,
      terminatedBySigkill: 0,
      totalKilled: 0,
    });
    await expect(startupSiblingSweep({ CONTEXT_MODE_STARTUP_SWEEP: "0" })).resolves.toEqual({
      terminatedBySigterm: 0,
      terminatedBySigkill: 0,
      totalKilled: 0,
    });
  });
});
