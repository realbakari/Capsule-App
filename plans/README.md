# Implementation plans

Prepared on 2026-09-20 against `db8eac65e5ab96efca5f47d4597d235a684c83e6`.
These began as implementation handoffs; their implementation was verified on
2026-09-21. They are local changes, not a published release. The selected first
phase covers UI hierarchy, sidebar status grouping, native reasoning controls
and reported quota windows. See [verification](verification-2026-09-21.md).

## Execution order and status

| Plan | Outcome | Priority | Effort | Risk | Depends on | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [001](001-composer-hierarchy.md) | Consistent composer hierarchy | P1 | M | Low | None | DONE |
| [002](002-sidebar-status-groups.md) | Optional cross-project status grouping | P1 | M | Medium | None; schedule after 001 | DONE |
| [003](003-muse-reasoning-default.md) | Native session reasoning control | P2 | M | Medium | None | DONE |
| [004](004-provider-quota-reporting.md) | Truthful subscription observations | P2 | M–L | Medium | 003 optional-read helper | DONE |

Status values: TODO, IN PROGRESS, DONE, BLOCKED (reason), REJECTED (reason).
Read the whole selected plan, check drift, follow its scope and stop conditions,
and record verification before marking it DONE. One concern per implementation
commit. No commit, push, pull request, deployment or release is authorized by
this planning handoff.

## Dependency and review notes

- 001 and 002 are independent features but share stylesheet and documentation
  files. Execute sequentially rather than making overlapping edits.
- 003 adds a small bounded optional metadata-read helper that 004 reuses.
  Both also touch the native fixture and session adapter. Reconcile those
  expected changes explicitly; do not overwrite them during a drift check.
- All UI changes require actual renderer geometry/interaction checks, dark/light
  screenshots, a populated isolated profile and the mock first user flow.
- Gateway/direct behavior, other harnesses, rejected operations, reverse states,
  and the read-only paired renderer remain part of each feature's acceptance.
- Existing native fixtures establish protocol behavior, not signed-in provider
  compatibility or native Windows certification. Keep those claims separate.
- The latest prior implementation gate passed 190 test files with 1,495 tests
  passing and two skipped, plus types, lint, build and seeded startup. This is
  a historical baseline from the preceding work, not a test run of these plans
  or of their future implementations. Re-run the gates when implementing.

## Findings considered and rejected

- Rebuild Markdown/code rendering: not selected. The current baseline already
  contains maintained parsing, grammar highlighting and saved-diff alignment
  fixes. Preserve those rather than replacing them during a layout pass.
- Add generic session resume: already implemented for Capsule-owned native
  sessions. External-session discovery/import is a distinct future feature.
- Show inferred subscription allowance from tokens/cost: rejected; those are
  different measurements. Unknown quotas stay unknown.
- Global sidebar requires a new backend query: rejected. `listLatestRuns()`
  already covers non-archived threads across projects.
- Change paired previews into remote control: out of scope; read-only is an
  intentional security boundary, not a missing UI connection.
- Copy a complete runtime or introduce a Capsule-owned agent loop: rejected
  by the workspace product contract.

## Deferred work

The subsequent request to make local agents primary was implemented alongside
these plans: new profiles default to Direct, Claude Code/Codex can use installed
local ACP adapters, and existing route preferences and thread identities remain
unchanged. The architecture and user setup docs describe the intentional change
from Gateway-first startup. This adds no agent loop or automatic installer.

- External native-session discovery/import: requires bounded history import,
  ownership checks, duplicate prevention and historical-run provenance.
- Native goals: require attribution of runtime-initiated turns and a distinct
  pause/resume lifecycle, not a renamed Stop button.
- Per-task background/stop controls: first preserve native task item IDs and
  terminal acknowledgements; generic tool-call IDs are not interchangeable.
- Full accessibility/security/performance audit and signed-in provider checks:
  this focused comparison and planning pass did not certify those areas.

No comparison-product source or assets were copied into these plans. User docs
and internal specs are implementation deliverables, not claims to update early.
