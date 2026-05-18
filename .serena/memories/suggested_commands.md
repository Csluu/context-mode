# Suggested commands

Use PowerShell on Windows for local commands unless running context-mode sandbox shell snippets.

- npm run build: TypeScript compile, bundle, bundle assertions, asymmetric drift check.
- npm run typecheck: tsc --noEmit.
- npm run test: runs Vitest; pretest runs build first.
- npx vitest run <test-file>: focused tests.
- npm run release:verify: supply-chain check, benchmark report, release reports, package, checksums, provenance.
- npm run dev: run MCP server via tsx.
- npm run doctor: run CLI doctor.
- npm run setup: setup via CLI.

Repo inspection: prefer rg/rg --files for small exact searches. For broad/noisy output follow AGENTS.md and use context-mode MCP tools (ctx_batch_execute, ctx_search, ctx_execute).