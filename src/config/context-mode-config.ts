import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { RouterMode } from "../routing/types.js";

const RouterModeSchema = z.enum(["off", "recommend", "rewrite"]);

export const ContextModeConfigSchema = z.object({
  schemaVersion: z.literal(1),
  router: z.object({
    mode: RouterModeSchema,
    allowAutoRewrite: z.array(z.string()),
    excludeCommands: z.array(z.string()),
    compoundCommands: z.enum(["classify-only", "recommend", "rewrite"]),
  }),
  read: z.object({
    mode: RouterModeSchema,
    fullReadRequiresReason: z.boolean(),
    largeFileLines: z.number().int().positive(),
    repeatReadCollapse: z.boolean(),
  }),
  sidecar: z.object({
    mode: z.enum(["off", "failures", "all"]),
    maxRunBytes: z.number().int().nonnegative(),
    maxProjectBytes: z.number().int().nonnegative(),
    ttlDays: z.number().int().nonnegative(),
    indexRawOutput: z.boolean(),
  }),
  analytics: z.object({
    local: z.boolean(),
    storeRedactedCommand: z.boolean(),
    storeFullCommand: z.boolean(),
    ttlDays: z.number().int().nonnegative(),
  }),
  telemetry: z.object({
    enabled: z.boolean(),
    externalTelemetryAllowed: z.boolean(),
  }),
  security: z.object({
    redactBeforePersistence: z.boolean(),
    blockSensitiveSidecars: z.boolean(),
    stripAnsiControls: z.boolean(),
  }),
  adapters: z.record(z.object({
    routerMode: RouterModeSchema,
  })).default({}),
});

export type ContextModeConfig = z.infer<typeof ContextModeConfigSchema>;
export const PartialContextModeConfigSchema = ContextModeConfigSchema.deepPartial();
export type PartialContextModeConfig = z.infer<typeof PartialContextModeConfigSchema>;

export interface ConfigSource {
  name: "default" | "project" | "user" | "env" | "per-call";
  config: PartialContextModeConfig;
}

export interface EffectiveConfig {
  config: ContextModeConfig;
  sources: Record<string, string>;
  warnings: string[];
}

export const DEFAULT_CONTEXT_MODE_CONFIG: ContextModeConfig = {
  schemaVersion: 1,
  router: {
    mode: "recommend",
    allowAutoRewrite: ["git status", "rg", "grep"],
    excludeCommands: [],
    compoundCommands: "classify-only",
  },
  read: {
    mode: "recommend",
    fullReadRequiresReason: true,
    largeFileLines: 500,
    repeatReadCollapse: true,
  },
  sidecar: {
    mode: "failures",
    maxRunBytes: 5 * 1024 * 1024,
    maxProjectBytes: 100 * 1024 * 1024,
    ttlDays: 14,
    indexRawOutput: false,
  },
  analytics: {
    local: true,
    storeRedactedCommand: true,
    storeFullCommand: false,
    ttlDays: 30,
  },
  telemetry: {
    enabled: false,
    externalTelemetryAllowed: false,
  },
  security: {
    redactBeforePersistence: true,
    blockSensitiveSidecars: true,
    stripAnsiControls: true,
  },
  adapters: {
    codex: { routerMode: "recommend" },
    openclaw: { routerMode: "recommend" },
  },
};

const ROUTER_RESTRICTIVENESS: Record<RouterMode, number> = {
  off: 0,
  recommend: 1,
  rewrite: 2,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setSource(sources: Record<string, string>, path: string, source: string): void {
  sources[path] = source;
}

function mergeObject(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
  source: string,
  sources: Record<string, string>,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const p = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && target[key] !== null
      && typeof target[key] === "object"
      && !Array.isArray(target[key])
    ) {
      mergeObject(target[key] as Record<string, unknown>, value as Record<string, unknown>, source, sources, p);
    } else {
      target[key] = value;
      setSource(sources, p, source);
    }
  }
}

function restrictRouterMode(base: RouterMode, proposed: RouterMode): RouterMode {
  return ROUTER_RESTRICTIVENESS[proposed] < ROUTER_RESTRICTIVENESS[base] ? proposed : base;
}

function applyProjectRestrictions(base: ContextModeConfig, project: PartialContextModeConfig, warnings: string[]): PartialContextModeConfig {
  const out = clone(project);

  if (out.router?.mode) {
    out.router.mode = restrictRouterMode(base.router.mode, out.router.mode);
    if (project.router?.mode !== out.router.mode) warnings.push("project router.mode cannot increase rewrite privilege");
  }
  if (out.read?.mode) {
    out.read.mode = restrictRouterMode(base.read.mode, out.read.mode);
    if (project.read?.mode !== out.read.mode) warnings.push("project read.mode cannot increase read privilege");
  }
  if (out.analytics?.storeFullCommand === true && base.analytics.storeFullCommand === false) {
    out.analytics.storeFullCommand = false;
    warnings.push("project analytics.storeFullCommand cannot weaken privacy");
  }
  if (out.telemetry?.enabled === true || out.telemetry?.externalTelemetryAllowed === true) {
    out.telemetry.enabled = false;
    out.telemetry.externalTelemetryAllowed = false;
    warnings.push("project telemetry cannot be enabled by repository config");
  }
  for (const key of ["redactBeforePersistence", "blockSensitiveSidecars", "stripAnsiControls"] as const) {
    if (out.security?.[key] === false && base.security[key] === true) {
      out.security[key] = true;
      warnings.push(`project security.${key} cannot weaken user/default security`);
    }
  }
  if (out.sidecar?.indexRawOutput === true && base.sidecar.indexRawOutput === false) {
    out.sidecar.indexRawOutput = false;
    warnings.push("project sidecar.indexRawOutput cannot enable raw indexing");
  }
  return out;
}

export function parseContextModeConfig(input: unknown, source = "config"): ContextModeConfig {
  const parsed = ContextModeConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`${source}: invalid context-mode config: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function parsePartialContextModeConfig(input: unknown, source = "config"): PartialContextModeConfig {
  const parsed = PartialContextModeConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`${source}: invalid context-mode config: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function loadContextModeConfigFile(filePath: string): PartialContextModeConfig | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  return parsePartialContextModeConfig(JSON.parse(raw), filePath);
}

export function resolveEffectiveConfig(sourcesIn: readonly ConfigSource[]): EffectiveConfig {
  const warnings: string[] = [];
  const sources: Record<string, string> = {};
  const config = clone(DEFAULT_CONTEXT_MODE_CONFIG) as unknown as Record<string, unknown>;
  mergeObject(config, DEFAULT_CONTEXT_MODE_CONFIG as unknown as Record<string, unknown>, "default", sources);

  const ordered = sourcesIn.filter((s) => s.name !== "default");
  const project = ordered.filter((s) => s.name === "project");
  const others = ordered.filter((s) => s.name !== "project");

  for (const src of project) {
    const restricted = applyProjectRestrictions(config as unknown as ContextModeConfig, src.config, warnings);
    mergeObject(config, restricted as Record<string, unknown>, src.name, sources);
  }
  for (const src of others) {
    mergeObject(config, src.config as Record<string, unknown>, src.name, sources);
  }

  return {
    config: parseContextModeConfig(config, "effective config"),
    sources,
    warnings,
  };
}

export function envConfig(env: NodeJS.ProcessEnv): PartialContextModeConfig {
  const out: PartialContextModeConfig = {};
  const routerMode = env.CONTEXT_MODE_ROUTER_MODE ?? env.CTX_MODE_ROUTER;
  if (routerMode) {
    out.router = { mode: routerMode as RouterMode };
  }
  if (env.CONTEXT_MODE_RAW === "1") {
    out.sidecar = { mode: "off", indexRawOutput: false };
    out.router = { ...(out.router ?? {}), mode: "off" };
  }
  if (env.CONTEXT_MODE_TELEMETRY === "1") {
    out.telemetry = { enabled: true, externalTelemetryAllowed: true };
  }
  return out;
}

export function redactedConfigForDiagnostics(effective: EffectiveConfig): Record<string, unknown> {
  const cfg = clone(effective.config) as unknown as Record<string, unknown>;
  return {
    ...cfg,
    sources: effective.sources,
    warnings: effective.warnings,
  };
}
