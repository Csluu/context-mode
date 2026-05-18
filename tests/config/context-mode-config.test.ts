import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_MODE_CONFIG,
  envConfig,
  loadContextModeConfigFile,
  parseContextModeConfig,
  parsePartialContextModeConfig,
  resolveEffectiveConfig,
} from "../../src/config/context-mode-config.js";

describe("context-mode config", () => {
  it("validates the default config", () => {
    expect(parseContextModeConfig(DEFAULT_CONTEXT_MODE_CONFIG).schemaVersion).toBe(1);
  });

  it("accepts partial layered config files", () => {
    const dir = mkdtempSync(join(tmpdir(), "context-mode-config-"));
    const file = join(dir, "context-mode.json");
    try {
      writeFileSync(file, JSON.stringify({ router: { mode: "off" }, sidecar: { mode: "failures" } }), "utf8");

      expect(parsePartialContextModeConfig({ router: { mode: "off" } }).router?.mode).toBe("off");
      expect(loadContextModeConfigFile(file)).toEqual({
        router: { mode: "off" },
        sidecar: { mode: "failures" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prevents project config from weakening security and privacy", () => {
    const effective = resolveEffectiveConfig([
      {
        name: "project",
        config: {
          router: { mode: "rewrite" },
          security: {
            redactBeforePersistence: false,
            blockSensitiveSidecars: false,
          },
          telemetry: {
            enabled: true,
            externalTelemetryAllowed: true,
          },
          analytics: {
            storeFullCommand: true,
          },
          sidecar: {
            indexRawOutput: true,
          },
        },
      },
    ]);

    expect(effective.config.router.mode).toBe("recommend");
    expect(effective.config.security.redactBeforePersistence).toBe(true);
    expect(effective.config.security.blockSensitiveSidecars).toBe(true);
    expect(effective.config.telemetry.enabled).toBe(false);
    expect(effective.config.telemetry.externalTelemetryAllowed).toBe(false);
    expect(effective.config.analytics.storeFullCommand).toBe(false);
    expect(effective.config.sidecar.indexRawOutput).toBe(false);
    expect(effective.warnings.length).toBeGreaterThan(0);
  });

  it("allows user config to opt into rewrite and then per-call to narrow", () => {
    const effective = resolveEffectiveConfig([
      { name: "user", config: { router: { mode: "rewrite" } } },
      { name: "per-call", config: { router: { mode: "off" } } },
    ]);

    expect(effective.config.router.mode).toBe("off");
    expect(effective.sources["router.mode"]).toBe("per-call");
  });

  it("maps emergency raw env to a restrictive config", () => {
    const partial = envConfig({ CONTEXT_MODE_RAW: "1" });
    expect(partial.router?.mode).toBe("off");
    expect(partial.sidecar?.indexRawOutput).toBe(false);
  });

  it("accepts CTX_MODE_ROUTER as the documented router-mode env alias", () => {
    expect(envConfig({ CTX_MODE_ROUTER: "off" }).router?.mode).toBe("off");
    expect(envConfig({ CTX_MODE_ROUTER: "rewrite" }).router?.mode).toBe("rewrite");
    expect(envConfig({ CTX_MODE_ROUTER: "off", CONTEXT_MODE_ROUTER_MODE: "recommend" }).router?.mode)
      .toBe("recommend");
  });
});
