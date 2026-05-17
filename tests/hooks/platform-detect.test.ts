import { describe, expect, it } from "vitest";

describe("hook platform detection", () => {
  it("honors explicit host override for OpenClaw", async () => {
    const { detectPlatformFromEnv } = await import("../../hooks/core/platform-detect.mjs");

    expect(detectPlatformFromEnv({ CONTEXT_MODE_HOST: "openclaw" })).toBe("openclaw");
  });

  it("uses current detect-capable platform env markers", async () => {
    const { detectPlatformFromEnv } = await import("../../hooks/core/platform-detect.mjs");

    expect(detectPlatformFromEnv({ CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe("claude-code");
    expect(detectPlatformFromEnv({ PI_CONFIG_DIR: "/tmp/pi" })).toBe("pi");
    expect(detectPlatformFromEnv({ PI_PROJECT_DIR: "/tmp/not-detect" })).toBe("claude-code");
    expect(detectPlatformFromEnv({ PI_CODING_AGENT_DIR: "/tmp/omp" })).toBe("omp");
  });
});
