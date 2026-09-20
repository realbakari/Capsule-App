# Plan 001: Make the composer visually consistent at every width

> Follow the steps and verification gates in order. This is a scoped UI plan,
> not permission to redesign the application. Update this plan's status in
> `plans/README.md` only after completing the done criteria.
>
> Drift check: `git diff --stat db8eac6..HEAD -- apps/desktop/src/renderer/src/features/conversation/Composer.tsx apps/desktop/src/renderer/src/features/conversation/ComposerTools.tsx apps/desktop/src/renderer/src/styles.css apps/desktop/src/renderer/src/testing/renderer-regressions.tsx apps/desktop/src/renderer/src/testing/composer-layout-regressions.tsx docs/user/composer.md docs/internals/desktop.md`
> Compare changed files with the excerpts below before editing. Stop if the
> design or behavior assumptions no longer match.

## Status

- Priority: P1
- Effort: M
- Risk: LOW; primary risk is hiding controls or disturbing scrolling.
- Confidence: HIGH in the identified layout surfaces; visual direction is a design choice, not a newly reproduced bug.
- Depends on: none
- Category: direction
- Planned at: `db8eac65e5ab96efca5f47d4597d235a684c83e6`, 2026-09-20
- Implementation status: DONE — see [verification](verification-2026-09-21.md).

## Why this matters

The expanded composer and its workspace strip should read as one compact dock,
with primary actions easy to find and secondary controls visually quieter.
Existing overlap and compact-mode fixes must remain intact. This pass changes
spacing and hierarchy, not what a prompt sends or which runtime receives it.

## Current state and constraints

- `apps/desktop/src/renderer/src/features/conversation/Composer.tsx:692` renders
  one `.composer-row` with `.composer-controls` and `.composer-prompt-actions`.
- `Composer.tsx:759` renders the folder, terminal and branch workspace strip.
- `apps/desktop/src/renderer/src/styles.css:1310` owns the glass surface:

  ```css
  .composer-glass {
    position: relative;
    z-index: 1;
    isolation: isolate;
    max-width: var(--chat-max);
    margin: 0 auto;
    border-radius: var(--composer-radius);
    padding: 0.85rem 0.9rem 0.6rem;
  ```

- `styles.css:1349` deliberately hides secondary controls in resting mode:

  ```css
  .composer.composer--resting .composer-controls,
  .composer.composer--resting .composer-tools,
  .composer.composer--resting .context-meter-wrapper,
  ```

- `apps/desktop/src/renderer/src/lib/composer-rest.ts` owns when resting mode is
  appropriate. Do not change its rules: multiline drafts, attachments, pickers,
  skills and drops keep the composer expanded; focus alone does not expand it.
- `apps/desktop/src/renderer/src/testing/renderer-regressions.tsx:845` already
  checks 360px/900px layouts, menu bounds, shared-row alignment, resting mode,
  and checkout visibility. Extend these guarantees; do not delete them.
- `ComposerTools.tsx` is the existing secondary-actions popover. Reuse its
  keyboard/focus handling and `MenuSelect`; do not introduce another menu library.
- `ARCHITECTURE.md` requires a centered chat column, glass composer, graphite
  and off-white, rem text sizes, no purple. Keep the shared chat width and
  existing semantic tokens. No emojis, new fonts, decorative effects or new
  runtime controls are needed.

## Scope

Only modify:

- `apps/desktop/src/renderer/src/features/conversation/Composer.tsx`
- `apps/desktop/src/renderer/src/features/conversation/ComposerTools.tsx`
- `apps/desktop/src/renderer/src/styles.css` — composer-scoped rules only
- `apps/desktop/src/renderer/src/testing/renderer-regressions.tsx`
- `apps/desktop/src/renderer/src/testing/composer-layout-regressions.tsx` — new focused fixture module
- `docs/user/composer.md`
- `docs/internals/desktop.md`
- This plan and its status row in `plans/README.md`

Do not change Markdown, syntax colors, saved diffs, transcript virtualization,
send/stop behavior, drafts, IPC, permission semantics, dependencies, release
configuration or global color tokens. Recent Markdown and diff fixes are not
part of this work.

## Commands and working method

Run from the repository root. Node 22+ and pnpm 10 are required. Use the existing
dependencies; do not reinstall them unless a missing dependency is diagnosed.

| Purpose | Command | Expected result |
| --- | --- | --- |
| Layout and interaction gate | `pnpm test scripts/renderer-regressions.test.mjs` | Exit 0, renderer regressions passed |
| Existing composer logic | `pnpm test apps/desktop/src/renderer/src/lib/composer-rest.test.ts apps/desktop/src/renderer/src/features/conversation/ComposerMenu.test.ts` | All selected tests pass |
| Types | `pnpm typecheck` | Exit 0 |
| Lint | `pnpm lint` | Exit 0 |
| Full suite | `pnpm test` | No failures |
| Production assets | `pnpm build` | Exit 0 |
| Startup | `node scripts/smoke-test.mjs` | Workspace loaded; normal shutdown |

Use `codex/composer-hierarchy` if a branch is needed. One logical commit, such
as `fix(composer): keep controls aligned across panel widths`; body explains
the layout problem and verification. No attribution trailers. Do not commit,
push, publish or open a PR without the operator's corresponding instruction.

## Steps

### 1. Characterize the existing dock before changing CSS

Add `runComposerLayoutRegressions(host, base)` in the new fixture module and
invoke it from the existing renderer runner. Follow the existing `createRoot`,
`window.testWorkspace`, two-frame settling and `finally` cleanup pattern in
`testing/panel-regressions.tsx`. Save and restore root font size, theme, host
width, test workspace and storage values; use synthetic project names only.

Cover host widths 320, 360, 640 and 900 CSS pixels, both themes, and root font
sizes 16 and 20 pixels. Test empty, long single-line, multiline, attachment,
open-menu, running, stopping and away-from-latest states. Initial tests should
characterize current behavior; add changed-design assertions with step 2.

Verify: `pnpm test scripts/renderer-regressions.test.mjs` → existing tests and
characterization pass without source behavior changes.

### 2. Tighten the visual hierarchy without removing affordances

Edit the existing composer CSS blocks rather than stacking overrides at EOF.
Use a consistent rem-based spacing scale. Keep model/agent and send/stop as
the strongest controls; render permissions, mode and secondary tools with
existing muted tokens. Target an empty expanded text field of roughly 3.5rem,
while multiline input grows within the existing viewport cap. Do not shrink
text to solve overflow or prevent a user's configured text size from scaling.

Keep attachment and send/stop in the same row as the expanded agent controls.
At narrow widths, use the existing overflow menu; preserve access to every
option by keyboard. The workspace strip remains inset under the glass, with
its interactive controls fully below the glass surface in resting mode.
Do not change compact/expanded mode in response to streaming tokens or focus.

Add geometry assertions: no actionable rectangles overlap; the expanded
controls/actions centerlines differ by less than 2 CSS pixels; menus remain
within the viewport; no document-level horizontal overflow; workspace controls
remain visible; resting height remains proportional to the root font size.
Keep assertions relative to rem/line-height where text scaling affects size.

Verify: run both focused test commands in the table, then `pnpm typecheck` and
`pnpm lint` → all pass. Fix layout rather than loosening overlap assertions.

### 3. Exercise the full surface and document the result

Use the real renderer with an isolated profile and populated conversations.
Never launch against the developer's live profile. The existing smoke script
accepts `CAPSULE_SMOKE_SEED_DATABASE`; it uses SQLite `VACUUM INTO` and sanitizes
only its disposable copy. Never use a plain copy of an open SQLite database.
The Electron `--user-data-dir` flag must precede the app path. Terminate only
processes captured when this verification launched them.

Check the mock first flow: create project → conversation → send → run → artifact.
Inspect light/dark screenshots at narrow/wide widths, sidebar and inspector
open/closed, streaming, and 125% zoom. Check the read-only paired view and
public sample renderer; existing write restrictions must remain unchanged.
Use fixtures for Gateway/direct differences rather than real signed-in agents.

Update the user composer guide and desktop spec with actual behavior, without
comparison-product names or claims that visual polish changes runtime support.

Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, then
`node scripts/smoke-test.mjs` → all pass. Record the exercised flows and any
unavailable platform checks in the implementation handoff.

## Done criteria

- [x] New width/theme/text-size regression matrix passes.
- [x] Existing draft, compact-mode, menu and streaming tests still pass.
- [x] Full commands above succeed; first-flow and screenshot evidence recorded.
- [x] `git diff --check` exits 0.
- [x] Changed files match these plans and the recorded local-first follow-up.
- [x] Both documentation audiences updated; plan index status updated.

## STOP conditions and maintenance

Stop if this requires changing send semantics, global colors, runtime code,
the compact-state contract, or files outside scope. Stop after two unsuccessful
attempts at the same failing gate and report the evidence. Never weaken an
existing geometry regression to make a design pass.

Future composer controls must join the same narrow-width matrix. Reviewers
should inspect screenshots as well as tests: rectangle assertions detect
overlap, not whether the visual hierarchy is pleasant.
