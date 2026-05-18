# Style and conventions

TypeScript ESM with explicit .js import suffixes in source imports. Tool handlers use zod input schemas and return MCP text result objects. Extracted tools should export ToolDefinition factories and register via src/tools/registry.ts so responses are tracked. Existing server.ts still has inline registerTool blocks; new feature work should prefer extracted src/tools/<feature>.ts plus server registration.

Use existing adapter output budgets from src/adapters/output-budget.ts, sidecar storage from src/artifacts/run-store.ts, filters/redaction from src/filters/pipeline.ts, session telemetry/event helpers from src/session/*, and OpenClaw metadata from src/adapters/openclaw/mcp-tools.ts. Avoid parallel plumbing.

Tests are Vitest. Add focused tests under tests/<feature> plus integration tests for MCP/server behavior when tool surfaces change.