# Plan 002: Add optional status grouping to the sidebar

> Follow the steps and gates below. Preserve project grouping as the default.
> Update `plans/README.md` only after completing the done criteria.
>
> Drift check: `git diff --stat db8eac6..HEAD -- apps/desktop/src/renderer/src/features/shell/Sidebar.tsx apps/desktop/src/renderer/src/lib/sidebar.ts apps/desktop/src/renderer/src/lib/sidebar.test.ts apps/desktop/src/renderer/src/styles.css apps/desktop/src/renderer/src/testing/panel-regressions.tsx docs/user/getting-started.md docs/internals/desktop.md`
> Stop on an unexplained mismatch with the excerpts or assumptions below.

## Status

- Priority: P1
- Effort: M
- Risk: MED; misleading status or changing row identity can hide waiting work.
- Confidence: HIGH
- Depends on: none functionally; run after 001 to avoid concurrent CSS/doc edits.
- Category: direction
- Planned at: `db8eac65e5ab96efca5f47d4597d235a684c83e6`, 2026-09-20
- Implementation status: DONE — see [verification](verification-2026-09-21.md).

## Why this matters

Users working across projects need to find conversations awaiting a decision
without opening each project. Add a reversible local view preference, not a
new inbox, database state or runtime lifecycle. Existing statuses, thread
actions and project organization remain authoritative.

## Current state and constraints

- `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx:193` classifies rows
  from the latest run and harness state. At line 659 it always renders projects:

  ```tsx
  {filteredProjects.map((item) => {
    const threads = sessionsFor(item.id);
    const isOpen = needle ? threads.length > 0 || item.id === projectId : !collapsed.has(item.id);
    const limit = restLimit[item.id] ?? SETTLED_THREAD_PREVIEW;
    const groups = splitProjectThreads(threads, kindOf, needle ? threads.length : limit);
  ```

- `apps/desktop/src/renderer/src/lib/sidebar.ts:1` contains pure status helpers:

  ```ts
  export type SidebarThreadKind = "working" | "approval" | "failed" | "ready";
  // In resolveSidebarThreadKind:
  if (input.runStatus === "approval_required" || input.runStatus === "blocked") return "approval";
  ```

- `Sidebar.tsx:361` has the reusable `renderThread` closure, including rename,
  keyboard activation, menus and pinned drag behavior. Preserve stable session
  keys and names; do not duplicate its interaction implementation.
- `apps/desktop/src/renderer/src/lib/workspace.tsx:722` already calls
  `api.listLatestRuns()` across all non-archived threads. Despite its name,
  `projectRuns` is not limited to the selected project. Live frames merge into
  it. No new backend query or transcript loading is needed.
- `packages/database/src/repositories.ts:761` returns lightweight latest runs:

  ```sql
  length(trim(r.result)) > 0 AS hasResult,
  ```

  Do not replace this summary with full prompt/result reads.
- `lib/sidebar.test.ts` tests classification; `testing/panel-regressions.tsx`
  already renders real Sidebar fixtures and checks collapsed approval priority.
- Product constraints: graphite/off-white, rem text, project/thread names
  rather than filesystem paths. A completed answer is not verified work.
  Both runtime routes use the same view logic. Viewer preferences are local
  presentation, never a grant to run thread actions.

## Scope

Only modify:

- `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx`
- `apps/desktop/src/renderer/src/lib/sidebar.ts`
- `apps/desktop/src/renderer/src/lib/sidebar.test.ts`
- `apps/desktop/src/renderer/src/styles.css` — sidebar-scoped additions only
- `apps/desktop/src/renderer/src/testing/panel-regressions.tsx`
- `docs/user/getting-started.md`
- `docs/internals/desktop.md`
- This plan and `plans/README.md`

Do not change engine/database queries, run status semantics, provider routes,
global settings schema, session titles, unread tracking, archives, IPC or
pin storage/order. Do not add polling or load conversations to classify them.

## Commands and git workflow

Run from the repo root with Node 22+ and the existing pnpm 10 installation.

| Purpose | Command | Expected result |
| --- | --- | --- |
| Grouping logic | `pnpm test apps/desktop/src/renderer/src/lib/sidebar.test.ts` | All cases pass |
| Actual interaction/layout | `pnpm test scripts/renderer-regressions.test.mjs` | Renderer regressions pass |
| Full suite | `pnpm test` | No failures |
| Types / lint | `pnpm typecheck` and `pnpm lint` | Both exit 0 |
| Production / startup | `pnpm build` then `node scripts/smoke-test.mjs` | Build and workspace startup pass |

Suggested branch: `codex/sidebar-status-groups`. Conventional commit example:
`feat(sidebar): group conversations by reported status`. No attribution or
comparison names. Commit/push/PR/release require operator instruction.

## Steps

### 1. Add a pure grouping model

Extend `lib/sidebar.ts` with explicit group identifiers and a pure grouping
function. Build one latest-run map per input collection, rather than searching
all runs for each group. Preserve the existing classifier's treatment of idle
persistent sessions and internal verification verdicts.

Groups, in this order:

1. **Needs you**: existing approval/blocked classification and genuine failed
   threads. Preserve the row's distinct Approval/Failed status; a failure is
   not an approval. A pinned waiting thread belongs here, not elsewhere too.
2. **Working**: existing working classification, including queued/waiting runs.
3. **Ready for review**: non-active, non-attention threads whose latest run is
   completed and has a result. This does not mean unread, verified or approved.
4. **Other conversations**: never-run, cancelled, result-less or other settled
   threads. Do not infer success from the generic `ready` classification alone.

Every active session appears once. Exclude archived sessions and sessions whose
project no longer exists. Within each group sort pinned first, then newest
`updatedAt`, then ID for ties; do not mutate inputs. Search matches project name
or thread title before grouping. Hide empty groups. Never collapse/cap Needs
you or Working; settled groups show 20 rows plus Show more/Show fewer, expanding
enough to keep the selected thread visible.

Add tests for each rule, two projects, stable ties, duplicates, absent run
summaries and transitions between groups. Verification:
`pnpm test apps/desktop/src/renderer/src/lib/sidebar.test.ts` → all pass.

### 2. Add the reversible view preference and reuse row interactions

Add an accessible **Group conversations** selector with **By project** and
**By status**. Use existing menu/icon components. Default to project grouping;
persist only the validated enum in localStorage under
`capsule.sidebarGrouping`. Unknown values or denied storage fall back safely.
Do not mutate project collapse state when toggling modes.

Render the status groups through the existing row function. In status mode,
show a small project-name context label without a filesystem path. Keep title
truncation, status and menu targets within the sidebar width. Keep rename,
navigation, pin/unpin and archive behavior. Disable pinned drag-reorder in
status mode because its order is derived; project mode retains existing drag
reorder. Do not silently drag across project boundaries.

Extend the panel regression fixture with two projects and an approval in the
non-selected project. Verify mode switching, persisted preference, malformed
preference, denied storage, search, focus, no duplicate rows, stable selected
thread and restoration of project mode. Verify live status updates by rerendering
the same fixture with changed summaries. Restore localStorage in `finally`.

Verification: `pnpm test scripts/renderer-regressions.test.mjs`,
`pnpm typecheck`, `pnpm lint` → all pass.

### 3. Verify accessibility and ship matching descriptions

Use sidebar widths 220, 264 and 400 pixels, long names, dark/light themes and
larger text. Ensure status is text as well as color. Keyboard users must reach
the grouping selector and thread/menu actions. Opening another thread still
selects the correct project. Add screenshot evidence using only an isolated
profile; never use the developer's live profile for a test launch. For a seeded
startup, use the smoke script's `CAPSULE_SMOKE_SEED_DATABASE` support, which
creates a one-way SQLite snapshot. Never kill processes by name.

Document the new preference, what each group means, and how to return to project
view in `docs/user/getting-started.md` and the desktop spec. Check the paired
read-only view and sample workspace. Run the mock first flow (project → thread
→ send → run → artifact) to confirm navigation did not break.

Verification: all commands in the table pass; `git diff --check` exits 0.

## Done criteria

- [x] Grouping tests cover two-project activity and all four categories.
- [x] Panel tests verify mode persistence, reverse state, search and focus.
- [x] Default project view and its pinned order remain unchanged.
- [x] Grouping adds no query, polling loop, transcript read or write-capable IPC.
- [x] Full tests/types/lint/build/smoke pass; screenshots and first flow recorded.
- [x] Scope reconciled with the local-first follow-up; docs and index updated.

## STOP conditions and maintenance

Stop if all-project summaries are no longer available, accurate grouping needs
new persistence/unread semantics, or changes require out-of-scope files. Report
the same gate failing twice rather than weakening tests. A new runtime status
must receive an explicit classification test; never silently call it complete.
Do not add universal unread or verification semantics in a later styling edit.
