# context-mode project overview

Purpose: MCP plugin/CLI that reduces context-window usage by routing noisy shell/file/web work through sandboxed execution, indexing, parsers, redacted sidecars, and search. Supports multiple adapters including Claude Code, Codex, Cursor, OpenCode, OpenClaw, Pi, Qwen, JetBrains Copilot, Gemini CLI, Zed, and others.

Tech stack: TypeScript ESM on Node >=22.5.0; MCP SDK; zod schemas; better-sqlite3 for local/session/search storage; esbuild bundling; Vitest tests.

Rough structure: src/server.ts is the main MCP server and still contains many inline tool registrations. src/tools/* contains extracted ToolDefinition-based tools registered through src/tools/registry.ts. src/adapters/* handles platform hooks/plugins/tool metadata. src/routing/* handles command classification/rewrite. src/parsers/* summarizes command output. src/artifacts/* stores redacted run sidecars. src/filters/* redacts secrets and strips controls. src/session/* stores telemetry/session state. docs/rtk-inspired-context-mode-spec.md tracks feature specs/features 13-17.
