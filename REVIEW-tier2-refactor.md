# Deep Review — `tier2/refactor` vs `main`

**Scope:** 213 files, +17,558 / −4,784 lines, 2 commits visible (`3be2dbc test`, `05453c9 Claude AI improvements`).
**Verdict:** Substantial, mostly-defensible hardening work (heal layers, plugin-cache integrity, tool registry refactor). Blocked from merge by 4 critical issues. Several medium issues. Branch is too large to land as one PR.

---

## CRITICAL — must fix before merge

### C1. Committed install-log files leak local user paths
**Files:** `.openclaw-install.log`, `.openclaw-install-bash.log`, `.openclaw-install-bash-rerun.log` (all `A`dded)

Contents include the maintainer's absolute Windows path: `C:\Users\chris\.openclaw` and `/c/Users/chris/Documents/GitHub/context-mode`. These are local artifacts — not source.

**Fix:**
1. `git rm` all three.
2. Add to `.gitignore`: `.openclaw-install*.log`
3. Trace which script wrote them (`scripts/install-openclaw-plugin.sh`?) and route output to a tmpdir or `.gitignore`d path.

### C2. Mega-PR — 213 files in one branch
17.5k LOC across heal layers, tool refactor, session/purge feature, render extraction, docs, config drift fixes, test changes, skill deletion. **Cannot be atomically reviewed.** High regression risk: rollback granularity is "all or nothing."

**Fix:** Split into:
1. `refactor/tool-registry` — `src/tools/{registry,types}.ts`, server.ts handler migration, tests.
2. `feat/session-purge` — `src/session/purge.ts` + tests + `ctx_purge` wiring.
3. `feat/plugin-cache-integrity` — `src/util/plugin-cache-integrity.ts`, `scripts/plugin-cache-integrity.mjs`, start.mjs hookup.
4. `fix/heal-*` — `scripts/heal-better-sqlite3.mjs`, `scripts/heal-installed-plugins.mjs`, postinstall changes (issues #408, #523, #531, #533, #550, #558).
5. `feat/security-bundle` — `src/security.ts` extraction + bundle.
6. `chore/render-extract` — `src/session/render/`.
7. `docs+configs` — README, CLAUDE.md, all `configs/*` drift.

### C3. CI doctor step is `continue-on-error: true`
`.github/workflows/ci.yml` calls `npx tsx src/cli.ts doctor` with `continue-on-error: true`. Doctor regressions silently pass CI. Defeats the integrity work added in this branch.

**Fix:** Remove `continue-on-error` OR gate it to a separate non-blocking job so doctor failures are visible.

### C4. `ctx-upgrade` inline-fallback executes remote git+npm with no provenance check
`src/tools/upgrade.ts` Inline-fallback path writes `.ctx-upgrade-inline.mjs` that does:
- `git clone --depth 1 https://github.com/mksglu/context-mode.git`
- `npm install` (runs arbitrary install scripts from cloned tree)
- `npm install --production` in user's plugin root

No commit-SHA pin, no checksum, no signature. If `mksglu/context-mode` is ever compromised (account, branch protection lapse, repo transfer), every `/ctx-upgrade` invocation in the wild executes attacker code. Spec ("Release Engineering Gates") explicitly requires "signed checksums" and warns against "executing remote scripts without user-visible source and checksum guidance."

**Fix (one of):**
- Pin to a release tag and verify via GitHub release asset SHA256.
- Use the npm-published tarball with `npm install context-mode@<exact>` only (no `git clone`).
- At minimum: log the source URL + commit SHA before execution, require user to confirm.

---

## HIGH

### H1. `src/util/sibling-mcp.ts` default-on `CONTEXT_MODE_STARTUP_SWEEP=1` sends SIGKILL
`startupSweep` discovers and `SIGTERM`→`SIGKILL`s other context-mode MCP children of the same parent at every boot. `sameParentOnly:true` guard helps, but:
- Surprises devs running two host clients (e.g., `opencode serve` + `claude`) intentionally.
- No grace window for the orphan to flush WAL → potential corruption of session DB (`better-sqlite3` WAL needs clean shutdown).

**Fix:** Default OFF or document loudly. If kept on, increase SIGTERM grace before SIGKILL (current loop is tight). Verify WAL flush behavior on SIGKILL.

### H2. `plugin-cache-integrity` keeps the parallel list it tried to kill
Module comments brag that required-siblings are derived from `package.json files[]` to avoid the "parallel hardcoded list" trap, then defines two hardcoded sets anyway:
- `LEGACY_FALLBACK` (frozen list of 7 paths)
- `SOFT_FALLBACK_BUNDLES` (4 paths)

These will drift the moment a bundle is renamed. Single-source-of-truth claim is partly cosmetic.

**Fix:** Either accept the fallback as belt-and-suspenders (and document trade-off), or compute soft-bundle set algorithmically too (e.g., explicit `softFallback: true` in the bundle outfile config / script comment).

### H3. `src/server.ts` grew +1996 lines despite tool extraction
`src/tools/MIGRATION.md` exists, suggesting incomplete migration. Net growth in server.ts contradicts the refactor's stated goal. Either:
- Migration not finished — finish it before claiming "refactor."
- Migration done — new server.ts code is unrelated feature work that should be in a separate PR (see C2).

Verify with `wc -l src/server.ts` before/after.

### H4. `tests/INHERITED-WIP.md` documents 22+ skipped tests
File-level + per-test skips: `tests/statusline.test.ts` (4), `tests/core/server.test.ts` (8), adapter `getSessionDBPath`/`getSessionEventsPath` removals (10). Marked "author WIP" with no owner, no expiry, no tracking issue.

**Fix:** Add owner + expiry + linked issue per skip. Spec requires "skip manifest entry containing owner, reason, and expiry" — adopt that schema now.

---

## MEDIUM

### M1. `.serena/project.yml` committed (154 lines)
If shared Serena onboarding for contributors — fine, but document in README. If per-maintainer IDE state — leak (paths, preferences). Audit content.

### M2. `R100 src/concurrency/runPool.ts → src/runPool.ts` flattens module boundary
`concurrency/` directory removed for a single file. Loses semantic grouping (where do future concurrency primitives go?). Either keep the directory or document the convention.

### M3. Heal-layer issue churn (#46915, #408, #523, #531, #533, #550, #558)
Seven distinct heal codepaths added. Sign of recurring config/path bugs in install/upgrade flow. Defensive code is correct, but the underlying contract (Claude Code's plugin loader expectations + `${CLAUDE_PLUGIN_ROOT}` resolution) is the root cause. Worth filing one upstream issue + linking each heal site to it.

### M4. `as never` triple-cast in `registry.ts`
Documented well but bypasses SDK generic safety. Acceptable since Zod `.parse()` enforces runtime, but add a unit test that verifies handler input shape matches `inputSchema` for every registered tool (failure mode: schema/handler drift would compile clean but throw at first call).

### M5. `src/tools/upgrade.ts` writes `.ctx-upgrade-inline.mjs` to `pluginRoot`
Plugin root may be inside `~/.claude/plugins/cache/` (read-only on some systems) or a worktree. Write may fail silently or pollute. Prefer `mkdtempSync(tmpdir(), 'ctx-upgrade-')`.

### M6. `assert-bundle` / `assert-asymmetric-drift` are new build gates without test coverage shown
Diff lists `scripts/assert-bundle.mjs` (82 LOC) and `scripts/assert-asymmetric-drift.mjs` (80 LOC) as additions. No corresponding `tests/scripts/assert-*.test.ts`. Build gates without tests are themselves a regression vector.

### M7. Bundle files committed (`server.bundle.mjs` +661, `cli.bundle.mjs` +786, all session bundles, new `security.bundle.mjs`)
Acceptable since project publishes bundles, but `assert-bundle` should run pre-commit (`.githooks/pre-commit` was added — verify it runs the assertion).

### M8. `skills/context-mode-ops/*` deletions (8 files removed)
Deleted skills: SKILL.md, agent-teams, communication, marketing, release, review-pr, tdd, etc. Was this intentional removal of a subfolder, or move? Need to verify there is no dangling reference in docs/configs.

---

## LOW / OBSERVATIONS

- README +267 lines is heavy doc churn — confirm marketing copy not over-claiming features still gated by experimental flag.
- `package.json` `version: 1.0.107 → 1.0.135` = 28 patch bumps on one branch. Indicates this is a long-lived integration branch. Squash strategy needs to preserve issue refs.
- `.patches/fix-idle-shutdown-default.patch` (71 lines) committed without context — is this an upstream-PR sidecar or applied patch? Document.
- `hooks/run-hook.mjs` is a good central wrapper for crash-resilience. Consider deprecating per-hook duplication once stable.
- `src/session/purge.ts` (355 LOC) has strong path-scoping (per-projectDir hash, worktree separation, content-dir dual-sweep for legacy raw-casing). Solid implementation; ensure `confirm:true` is required at the MCP boundary in registry wiring.
- `src/security.ts` extracted to its own bundle. `parseBashPattern` regex `^Bash\((.+)\)$` is greedy — correctly handles nested parens (`Bash(echo (foo))`). Good.

---

## What's good (keep)

- `tools/registry.ts` auto-`trackResponse` wrapping closes a real footgun (10+ manual call sites in old server.ts).
- Plugin-cache integrity algorithmic derivation from `files[]` is the right direction (despite H2).
- `heal-better-sqlite3` 3-layer defense + Conda detection + VS 2026 year-detection is thorough; #533 + #408 root-cause work is high-quality.
- `purge.ts` scoping (`project` vs `session`, hash-based file targeting, Windows file-lock awareness) is careful.
- `sibling-mcp` `sameParentOnly` design constraint is the right safety boundary (modulo H1's default-on concern).
- New CI benchmark gate (`npm run benchmark:check`, Linux-only).

---

---

# PART 2 — Spec Compliance Audit (`docs/rtk-inspired-context-mode-spec.md` + audit + validation plan)

## All release gates verified PASS

Ran the spec's Step 1–5 validation procedure on the branch:

| Gate | Result | Notes |
|------|--------|-------|
| `npm run typecheck` | ✅ EXIT 0 | clean |
| `npm run precommit` | ✅ EXIT 0 | 7 bundles fresh, asymmetric drift OK |
| `npm run skip:audit:strict` | ✅ EXIT 0 | 100 skip markers, 0 unmanifested |
| `npm run guard:fixtures` | ✅ EXIT 0 | zero secret leakage |
| `npm run eval:fast` | ✅ EXIT 0 | all `guard`/`parser`/`router`/`cache`/`diff` cases pass |
| `npm run benchmark:check` | ✅ EXIT 0 | 76,654 → 9,881 bytes = **87% reduction** (≥80% spec threshold) |
| `npm run supply-chain:check` | ✅ EXIT 0 | 244 deps, SBOM written |
| `npm test` | ✅ EXIT 0 | **1589 passed / 680 skipped (2500 total)** |

## Spec module presence — 100%

All spec-claimed modules exist and ship:

- `src/routing/{rewrite-registry,command-classifier,command-coverage,types}.ts` ✅
- `src/parsers/{registry,types}.ts` ✅
- `src/filters/{pipeline,types}.ts` ✅
- `src/read/ctx-read.ts` ✅
- `src/artifacts/{run-store,redaction}.ts` ✅
- `src/config/context-mode-config.ts` ✅
- `src/cache/explain.ts`, `src/diff/git-text.ts`, `src/eval/{cli,harness}.ts`, `src/guard/scanner.ts`, `src/trace/summary.ts` ✅
- `src/adapters/output-budget.ts` ✅
- All 10 spec-new MCP tools: `route, fetch-run, read, gain, discover, cache, diff, eval, guard, trace` ✅
- All 5 release/supply-chain scripts: `release-{package,checksums,provenance,candidate-reports}.mjs`, `supply-chain-check.mjs` ✅
- All 12 spec-required `package.json` scripts ✅
- `tests/skip-manifest.json` ✅
- Spec test files (sampled 10) ✅

**Earlier C2 (mega-PR) and H3 (server.ts growth) are reframed**: the branch is not "refactor" — it is the full RTK spec implementation slice. Size is justified by spec scope. C2 downgraded; still recommend logical split per release-readiness PR practice, not as a blocker.

## Spec-defined safety properties — verified

| Property | Verified | Evidence |
|----------|----------|----------|
| `CTX_MODE_ROUTER=off` / `CONTEXT_MODE_ROUTER_MODE` kill-switch | ✅ | `hooks/core/routing.mjs:54`, `src/routing/rewrite-registry.ts:232` `mode === "off" → autoRewriteEligible:false` |
| Experimental tools gated | ✅ | `registry.ts:14` env check; `experimental:true` on `eval`, `guard`, `cache`, `trace`, `diff` (matches spec) |
| `ctx_purge` confirm enforcement | ✅ | `server.ts:3644` confirm gate + `:3711` deprecation warning for bare `confirm:true` (now requires scope) |
| Insight server DNS-rebind + origin protection | ✅ | `insight/server.mjs:1220` allowlist {`localhost`, `127.0.0.1`}, 403 on unknown origin, binds `127.0.0.1` only |
| Output budget truncation marker | ✅ | `adapters/output-budget.ts` emits structured `[context-mode: response truncated for <adapter> ... omitted ~Xkb]` |
| Bundle drift / asymmetric-drift checks | ✅ | precommit gate + `assert-bundle` + `assert-asymmetric-drift` in build chain |
| Guard scanner secret patterns | ✅ | 34 regex patterns in `src/guard/scanner.ts` (479 LOC); eval-fixture `safe-placeholder` allows clean baseline |

## Spec-out-of-scope items (correctly deferred per audit)

- Hosted external provenance attestation (local SLSA-style provided).
- Tree-sitter / LSP code-map providers (TS compiler + heuristic shipped).
- Native Read/Grep/Glob bypass capture beyond adapter capability.
- Broad `ctx_cache` serving (canary-gated to `tsc --noEmit`).
- Network-command auto-rewrite (classify-only).

These are all explicitly enumerated in `validation-plan §7` — no silent omissions.

---

# PART 2 — New / sharpened findings after deep audit

### NEW-CRITICAL — none. Branch passes spec gates.

### NEW-HIGH

#### NH1. Skip manifest is compliance-shaped, not content-shaped
`skip:audit:strict` passes because every skip has owner/reason/expiry. Quality is poor:
- Every entry has `"owner": "private-fork"` — not a person, not a team.
- Reasons are 4 copy-pasted templates ("fixture expectations need re-alignment", "inherited WIP suite ... re-documented").
- **Every expiry is the exact same date `2026-12-31`** — manifest will cliff-fail in bulk on a single day.
- 21 skipped test files + 680 skipped test cases = **27% of suite skipped**. 12 of 21 files trace to `adapters/*` or `session/*` — these are central to the product.

The spec wanted skips to be tracked individually. Schema is met; intent is not.

**Fix:** Stagger expiries across Q1/Q2/Q3 2026. Replace blanket `"private-fork"` owner with the actual person who can revive each suite. Split file-scoped entries into per-case entries where the file mixes passing + failing tests.

#### NH2. `src/artifacts/redaction.ts` is an 11-line façade
File re-exports `redactText` from `src/filters/pipeline.ts`. Spec lists `src/artifacts/redaction.ts` as a top-level module; reviewers expecting redaction logic there will get redirected. Acceptable architectural choice, but:
- Risk-targeted regression test in validation plan `§6` says `redaction.ts` "regex regression leaks secrets" — but the actual regex lives in `filters/pipeline.ts`. Test-target/source-location mismatch makes incident triage slower.

**Fix:** Either inline the implementation into `artifacts/redaction.ts` (matches spec module map) or update `validation-plan §6` to point at `filters/pipeline.ts` as the risk target.

### NEW-MEDIUM

#### NM1. Audit doc is stale (counts drift)
`docs/rtk-spec-completion-audit.md` claims `1551 tests / 678 skipped`. Actual today: `2500 tests / 680 skipped`. Test count grew 61% since audit was written. Audit should regen before release tag.

#### NM2. `tests/INHERITED-WIP.md` and `tests/skip-manifest.json` are partially redundant
Two parallel docs tracking skip metadata. INHERITED-WIP is prose; skip-manifest is the gate's input. Either consolidate or wire INHERITED-WIP to be generated FROM the manifest so they cannot drift.

#### NM3. SQLite experimental warning spam in test output
Every test process emits `ExperimentalWarning: SQLite is an experimental feature` (Node's built-in `node:sqlite`). Not a blocker but adds 60+ noise lines to test transcript. Set `NODE_NO_WARNINGS=1` for the `vitest` invocation OR migrate the offending paths to `better-sqlite3` only.

#### NM4. CTX_MODE_EXPERIMENTAL gate uses OR-fallback that leaks
`registry.ts:15`: `env.CTX_MODE_EXPERIMENTAL ?? env.CONTEXT_MODE_EXPERIMENTAL ?? ""`. Both env vars accepted — fine — but the lax regex `/^(1|true|yes)$/i` means a stray `CTX_MODE_EXPERIMENTAL=YES` from a developer's shell silently enables `ctx_eval`, `ctx_guard`, `ctx_cache`, `ctx_trace`, `ctx_diff` in production user sessions. Consider requiring a more explicit signal (e.g., `=1` only) since these are gated for safety, not UX.

### NEW-LOW

- `redaction.ts` and `output-budget.ts` are small (11 / 98 LOC). Confirm both make it into the published `files[]` (verified — yes, in `build/**`).
- Spec mentions `forbiddenText: GITHUB_TOKEN` in `ctx_eval` example. Verified `guard:fixtures` exercises this class via the `safe-placeholder` case but only documents the placeholder fixture — would benefit from an explicit positive-leak fixture that the guard must **block** (not just an allow case).
- `validation-plan §8 sign-off checklist` requires `context-mode hook test --adapter <each tier-1 adapter>` — manual step, no CI coverage. Adapter contract tests cover the API but not the hook-execution surface.

---

## Updated verdict

The branch **implements the RTK-inspired spec** correctly against every automatically-verifiable acceptance metric. Critical issues C1 (committed logs) and C3 (CI doctor `continue-on-error`) from Part 1 still stand. C2 (mega-PR) is **downgraded** — size is spec-scope-justified. C4 (upgrade provenance) still stands.

The H1 (sweep default-on), NH1 (manifest quality), and NH2 (redaction façade) are the remaining release-quality items.

---

## Recommended merge sequence

1. Land C1 (log scrub) + C3 (CI doctor gate) as immediate hotfix to `main`.
2. Split branch per C2.
3. Address C4 (upgrade provenance) before any further `/ctx-upgrade` advertising.
4. Land H4 (skip manifest) before/with `tools/registry` PR (tests pass clean).
5. Settle H1 (sweep default) via short RFC — user-visible behavior change.
