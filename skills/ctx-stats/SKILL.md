---
name: ctx-stats
description: |
  Show how much context window context-mode saved this session.
  Displays token consumption, context savings ratio, and per-tool breakdown.
  Read-only — shows stats only, no reset capability.
  To wipe the knowledge base entirely, use ctx_purge instead.
  Trigger: /context-mode:ctx-stats
user-invocable: true
---

# Context Mode Stats

Show context savings for the current session.

## Instructions

1. Call the `mcp__context-mode__ctx_stats` MCP tool with `scope: "session"` unless the user explicitly asks for lifetime/all-session totals.
2. **CRITICAL**: You MUST copy-paste the ENTIRE tool output as markdown text directly into your response message. Do NOT summarize, do NOT collapse, do NOT paraphrase. The user must see the full tables without pressing ctrl+o. Copy every line exactly as returned by the tool.
3. After the full output, add ONE sentence highlighting the key savings metric, e.g.:
   - "context-mode saved **12.4x** — 92% of data stayed in sandbox."
   - If no data yet: "No context-mode calls yet this session."

## Purge

- **`ctx_gain()`** — Use when the user asks specifically how much context-mode saved this chat/session.
- **`ctx_discover()`** — Use when the user asks what bypassed context-mode or where savings were missed.
- **`ctx_purge(confirm: true, scope: "project")`** or **`ctx_purge(confirm: true, sessionId: "...")`** — Permanently deletes indexed content. Use `/context-mode:ctx-purge` for this.
