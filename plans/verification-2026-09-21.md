# Implementation verification — 2026-09-21

Baseline: `db8eac65e5ab96efca5f47d4597d235a684c83e6`. This record captures
verification of the four plans and the subsequent local-first request before
committing and pushing. No release, installation or live-profile migration was
performed during verification.

## Outcomes

- Composer spacing uses the existing layout and rem scale. Multiline growth
  follows the CSS height limit. Draft, send/stop, compact mode and menus retain
  their existing behavior.
- Sidebar status grouping reuses all-project run summaries and existing thread
  actions. Project grouping remains the default. A discovered selector collision
  was fixed by naming the conversation approval card separately from sidebar
  status badges; that includes the small `Conversation.tsx` class-name change.
- Native Muse reasoning uses exact supported tiers, accepted commands and
  session notifications. Resume recovery is one bounded optional read; stale
  results cannot overwrite newer settings. Both UI entry points and paired
  write denial are covered.
- Subscription usage is a cache of provider observations, not estimated account
  allowance. Missing, stale, reset-passed, future-clock, over-limit, multi-source,
  close, error and retry cases are covered. Reads do not start an agent or issue
  provider requests. The existing transcript usage view remains separate.
- New profiles default to local agents. Startup and new local conversations do
  not call the Gateway. Claude Code and Codex use separately installed ACP
  adapters; startup, replies, model configuration and session resume use the
  existing direct transport. No package is downloaded automatically. Existing
  Gateway preferences and conversation identities are retained.

The last item is an explicit addition to the original plans. Its source scope
includes runtime defaults, harness presets/probing, engine startup/session
creation, direct-host command selection, Settings, Harnesses and shell connection
indicators, with corresponding tests and docs. The architecture documents the
intentional change from Gateway-first startup. Other unrelated files were not
changed.

## Gates

- `pnpm test`: 195 files passed; 1,535 tests passed, two skipped.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed.
- Populated startup: the existing smoke runner took a SQLite `VACUUM INTO`
  snapshot of the live database, sanitized only the disposable copy, loaded
  Capsule 0.6.3 in one window and quit normally. Nothing was written back.
- Built-app first flow: created a disposable Git project and conversation via
  the actual preload/main IPC, navigated from the sidebar, typed and clicked
  Send in the real composer, observed completion and a rendered reply, then
  inspected artifacts and the saved diff. The mock correctly produced no
  artifacts because it did not edit files. The deliberate `[tool]` failure
  scenario was checked separately from the successful plain prompt.
- `git diff --check`: passed. Changed-file review reconciled all four plans,
  their tests/docs and the explicitly requested local-first follow-up.

## UI evidence

The real renderer matrix covers dark/light palettes, 16/20px root text, widths
320/360/640/900, and empty, long, multiline, attachment, menu, running, stopping
and resting states. Geometry checks cover target overlap, control alignment,
menu viewport bounds, focus restoration and the inset workspace strip. Existing
streaming/history, inspector, Markdown, saved preview and public sample tests
also passed.

Temporary screenshots and the capture harness are in
`/tmp/capsule-ui-verification.aRTJ3Z`. They include expanded/compact composers,
status-grouped sidebars, subscription usage, runtime settings and the built-app
first flow. Sidebar width requests of 220/264/400 use the app's actual CSS width
variable and respect its existing 15rem minimum and 22rem maximum at 16/20px
text sizes; a cropped narrow browser window is not treated as a layout test.
Dark/light screenshots were inspected, with no comparison assets imported.

## Limits

Native ACP/MSP compatibility was verified with protocol fixtures, not signed-in
Claude Code, Codex or Muse accounts on every adapter version. This is not native
Windows certification. Paired devices remain read-only. Remote browser control,
external-session import, native goals and per-task stop controls remain outside
these plans. Existing installations keep their saved runtime preference; choose
Settings → Agents → Runtime → Direct for new local conversations.
