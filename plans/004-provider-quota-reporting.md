# Plan 004: Show provider-reported subscription quotas without guessing

> Follow the steps and verification gates in order. Keep subscription quotas,
> token accounting and monetary cost as separate concepts. Update the plan
> index only after the complete route and UI have been tested.
>
> Drift check: `git diff --stat db8eac6..HEAD -- packages/shared/src packages/muse/src packages/acp/src/host.ts packages/acp/src/session.ts packages/core/src/engine.ts packages/core/src/muse-flow.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/features/library apps/desktop/src/renderer/src/features/landing/demoBridge.ts apps/desktop/src/renderer/src/lib/remote-bridge.test.ts apps/desktop/src/renderer/src/testing/panel-regressions.tsx apps/desktop/src/renderer/src/styles.css docs/user/providers.md docs/user/reading-from-another-device.md docs/internals/harness.md docs/internals/desktop.md`
> The directory arguments are a drift-scan superset, not edit authorization.
> Only the exact files listed under Scope may change. Reconcile expected plan
> 003 changes first; stop on other unexplained drift.

## Status

- Priority: P2
- Effort: M–L; involves transport, main/preload, paired reads and presentation.
- Risk: MED; stale or cross-account reports can mislead users.
- Confidence: HIGH on the protocol payload; live account reporting is unverified.
- Depends on: 003's bounded optional-read helper; coordinate overlapping fixture/docs edits.
- Category: direction
- Planned at: `db8eac65e5ab96efca5f47d4597d235a684c83e6`, 2026-09-20
- Implementation status: DONE — see [verification](verification-2026-09-21.md).

## Why this matters

Transcript token counts cannot tell users how much subscription capacity remains
or when it resets. Add a small provider-reported section to Usage, initially
for native Muse only. Missing or old observations must stay visibly unknown or
stale rather than looking like live, unused allowance.

## Current state and evidence

- `apps/desktop/src/renderer/src/features/library/UsageView.tsx:155` says:

  ```tsx
  Includes sessions run outside Capsule. Tokens only — prices are not in the
  transcripts.
  ```

  Its accounting is intentional; do not replace it or add a speculative price table.
- `features/conversation/ReportedUsage.tsx:12` separately displays context,
  turn tokens and cumulative session cost. Subscription quota is none of these.
- `packages/muse/src/session.ts:245` currently filters notifications by session:

  ```ts
  if (!this.id || params.sessionId !== this.id || this.closed) return;
  ```

  The native `usage/changed` payload is connection-level and has no session ID.
  Routing it through this guard would silently lose every observation.
- Pinned SDK references in
  `packages/muse/node_modules/@muse-code/sdk/dist/src/msp.d.ts:1660`:

  ```ts
  export interface SubscriptionUsage {
    observedAtMs: number;
    tier: string;
    weekly: SubscriptionUsageWeekly;
    window: SubscriptionUsageWindow;
  }
  ```

  The window has `usedPercent`, `resetsAtMs`, `windowDurationMins`; the weekly
  block has percentage/reset only. Percentages above 100 are valid. At line
  2065, `usage/read` returns `{usage?}` with honest absence when nothing was seen.
  This is a cached observation, not a new provider measurement.
- `packages/acp/src/host.ts:18` defines a protocol-neutral session surface using
  `Pick<DirectAcpSession, ...>`. Extend it with an optional report getter; do not
  make other adapters fabricate subscription support.
- `packages/core/src/engine.ts:2448` routes session-level configuration before
  locating an active run. Quota notifications also belong before that run guard,
  not in assistant text or turn-token events.
- `packages/shared/src/ipc-scopes.ts:79` defaults unnamed channels to write.
  The new channel may be read-only only because its handler reads in-memory
  snapshots and cannot launch a CLI, send a prompt or trigger provider I/O.
- The preload's exported `CapsuleApi` supplies renderer typing. The paired
  bridge is generated from `IPC_CHANNELS`; server scopes still enforce access.

## Scope

Only modify or create:

- `packages/shared/src/provider-usage.ts` and `provider-usage.test.ts` — new bounded data contract/validation
- `packages/shared/src/index.ts`, `ipc.ts`, `ipc-scopes.ts`, `ipc-scopes.test.ts`
- `packages/muse/src/session.ts`, `session.test.ts`, `fixtures/agent.mjs`
- `packages/muse/src/optional-query.ts`, `optional-query.test.ts` — helper from 003, only if needed for shared bounded-read behavior
- `packages/acp/src/host.ts`, `session.ts` — optional report surface and typed event only, not ACP behavior
- `packages/core/src/engine.ts`, `muse-flow.test.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/features/library/UsageView.tsx`
- `apps/desktop/src/renderer/src/features/library/ProviderQuota.tsx`, `ProviderQuota.test.ts` — new focused component/pure presentation tests
- `apps/desktop/src/renderer/src/features/landing/demoBridge.ts`
- `apps/desktop/src/renderer/src/lib/remote-bridge.test.ts`
- `apps/desktop/src/renderer/src/testing/panel-regressions.tsx`
- `apps/desktop/src/renderer/src/styles.css` — quota-component rules only
- `docs/user/providers.md`, `docs/user/reading-from-another-device.md`
- `docs/internals/harness.md`, `docs/internals/desktop.md`
- This plan and `plans/README.md`

No account scraping, new provider HTTP client, credential reading, agent spawn
for usage, database persistence, reset-credit consumption, pricing estimates,
other-provider claims, sidebar meter, remote control, dependencies or releases.
This phase reads existing native connections only. Keep the default chat simple.

## Commands and git workflow

Run from the root, with Node 22+ and the existing pnpm 10 installation.

| Purpose | Command | Expected result |
| --- | --- | --- |
| Contract/scopes | `pnpm test packages/shared/src/provider-usage.test.ts packages/shared/src/ipc-scopes.test.ts` | Validation and authorization cases pass |
| Transport/integration | `pnpm test packages/muse packages/core/src/muse-flow.test.ts` | All fixture scenarios pass |
| Rendering/remote bridge | `pnpm test apps/desktop/src/renderer/src/features/library/ProviderQuota.test.ts apps/desktop/src/renderer/src/lib/remote-bridge.test.ts scripts/renderer-regressions.test.mjs` | Pure and Electron interaction tests pass |
| Full gates | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` | Each exits 0 |
| Startup | `node scripts/smoke-test.mjs` | Workspace loads and quits normally |

Suggested branch: `codex/provider-quota-reporting`. Example commit title:
`feat(usage): show reported subscription windows`. No attribution trailers or
comparison names. No commit/push/PR/publication without the matching instruction.

## Steps

### 1. Define a small, validated snapshot contract

Create a browser-safe normalized report with provider ID, observation timestamp,
bounded tier label, and two explicit quota-window records. Treat all wire values
as untrusted: percentages are nonnegative safe integers, including values over
100; timestamps must be finite valid nonnegative JavaScript date values; window
duration must be a positive safe integer. Preserve zero rather than treating it
as absence. Sanitize/cap labels with the existing shared untrusted-text helper.
Reject malformed reports, not the active conversation.

Define the IPC result as a bounded list of source-labelled observations plus
explicit absence. A source identifies the Capsule session, never a guessed
account. Do not sum, average or deduplicate different connections as though
they share a subscription; the protocol supplies no account identity.

Verification: add validation cases for missing fields, zero, >100, NaN/infinity,
negative/future/reset timestamps and hostile labels. Run the contract test
command → all pass; `pnpm typecheck` → exit 0.

### 2. Observe native quota updates independently of turns

In `DirectMuseSession`, handle `usage/changed` after the closed check but before
the session-ID and active-turn guards. Store just one latest valid report per
owned connection. Reject older observations; identical reports produce no new
event. A malformed update must not clear the last valid report. Conflicting
notifications with the same timestamp may replace in notification arrival
order, but never produce an aggregate. Track an accepted-notification generation
separately from the observation timestamp so a read is not mistaken for a new
notification.

After initialization, issue at most one optional `usage/read` query per owned
connection, using plan 003's 3-second, nonfatal, no-retry helper. Race-safe
timestamp comparison must prevent its late result overwriting a newer event.
Capture the notification generation when starting the read: if a notification
has since been accepted, a read with an equal or older timestamp cannot replace
it. An otherwise valid read with a strictly newer observation timestamp may
apply before the deadline. Timed-out results never apply, as required by 003.
An empty result means no report, not zero usage; a missing method leaves quota
unavailable without failing normal chat. Refreshing the UI must never repeat
this query. Together with reasoning recovery, at most two optional reads may
remain pending per connection until reply/close. Keep the 4 MiB frame cap.

Expose an optional `reportedSubscriptionUsage` getter on the native session
surface. Add a typed `subscription-usage` notification to `DirectAcpEvents` and
`DirectActivity`; other adapters need not emit it. Treat the activity as snapshot
invalidation, not just a new-report event: after removing a native source on
close, shutdown or unexpected process exit, emit it again so subscribers can
discard that source. Do not rely on the existing `acp-reply` exit event; idle
exits need not produce a reply that Core handles. The host returns only cached
reports from still-running native sessions.

Verification: `pnpm test packages/muse` → covers global notifications without
session IDs, updates while idle, stale initial read, malformed payload, method
missing, no repeated reads, timeout without failing a turn and cleanup. Include
an initial read finishing after a conflicting notification with the same
`observedAtMs`; the notification must win.

### 3. Connect a strictly read-only IPC path

Add named `providerUsage` in shared IPC, preload, main and Core. Core maps the
host's source keys to current Capsule sessions and returns at most 128 reports,
ordered newest first. Unknown/deleted/mismatched sources are excluded. Do not
return raw native keys, account credentials, SDK records, workspace paths or
tool history. Mark the channel read-only only after proving the handler is a
snapshot read with no protocol requests, spawning or state mutation.

In the direct-activity handler, emit a `state` notification with command
`provider-usage` before looking for a run. Do not append quota events to a run,
make a transcript message or reload the whole workspace. The Usage component
subscribes to this signal, coalescing burst reads and cleaning up on unmount.
Emit the same invalidation after Core persists a newly spawned/resumed native
session identity: the initial report can arrive before Core can map the host's
source key. This post-persistence signal makes the cached report discoverable
without requiring another provider notification. Emit invalidation for source
removal even if its Capsule session no longer exists. Run completion and native
close/exit must leave mounted UI state accurate without manual refresh; a manual
refresh must also reveal closed/removed sources.

Test the engine with two fixture sources, idle updates, close/reopen and no
signed-in CLI. Keep Usage mounted in fixtures for (a) a quota report arriving
before identity persistence and (b) an unexpected idle process exit with no
stderr/reply text. Assert first-report appearance and closed-source removal
without a remount or manual refresh. Extend scope and paired-bridge tests: reads allowed, existing
configuration/turn writes still denied. In the public sample bridge, return an
explicit empty report list, never invented subscription percentages.

Verification: contract/scopes and transport/integration commands pass;
`pnpm typecheck` and `pnpm lint` both exit 0.

### 4. Present truthful quota cards alongside token accounting

Add a compact **Subscription usage** section to Usage, above the existing token
section. Keep token accounting untouched. Show provider/tier, source thread,
window duration, exact used percentage, observation time/age, and reset time.
With multiple sources, provide a labelled source selector; do not combine them.
Do not claim a report is live or exhaustive of usage from other applications.

Use these states explicitly:

- No report: **Not reported yet** with guidance that an existing native session
  must report usage; never start one as a side effect of viewing the page.
- More than five minutes old: label **Last reported**, retain values and age.
- Reset time has passed: **Reset time passed; awaiting a new report**; do not
  zero the percentage or advance the reset on the client's clock.
- Observation over five minutes in the future: disclose a clock difference;
  do not present a negative age or silently call it fresh.
- IPC failure: retain any previous report as stale, show a retryable read error.

Clamp only the visual progress fill to 0–100; preserve the reported percentage
in text and accessible value text. Color is supplementary. Use graphite
surfaces and existing semantic warning colors, rem typography and restrained
spacing. A timer may update displayed ages once per minute while mounted; it
must not poll the provider. Label Refresh as rereading the latest observation,
not obtaining live provider totals. Feature-detect an old preload method and
show unavailable guidance instead of throwing.

Extend panel fixtures for missing/zero/over-limit/stale/reset-passed/future/error
states, two sources, native close, theme/width, event subscription cleanup and
read-only bridge rendering. Follow existing `panel-regressions.tsx` cleanup.

Verification: rendering/remote bridge command → all pass. Inspect narrow/wide
dark/light screenshots in an isolated profile, never the live profile.

### 5. Document scope and run all gates

Document observation provenance, no-report state, read-only paired access,
native-only scope, and the fact that refresh is not a fresh provider measurement.
Update both user and internal docs. Keep fixture-vs-live-provider caveats.
Run the full gates and startup command, then exercise the mock first flow
(project → conversation → send → run → artifact). For populated startup use
the smoke script's safe `CAPSULE_SMOKE_SEED_DATABASE` snapshot support. Never
write back to the source profile or kill a process identified by name.

Verification: every gate exits 0; `git diff --check` exits 0; only scoped files
appear in `git diff --name-only`/`git status --short`.

## Done criteria

- [x] Exact reported percentages, timestamps, provenance and absence survive IPC.
- [x] Global/idle updates arrive without creating a run or chat message.
- [x] Multiple sources are not treated as a shared account or summed.
- [x] Closed sources and late requests cannot expose obsolete account state.
- [x] Mounted Usage sees early reports after identity persistence and idle exits.
- [x] Viewing/refreshing/paired reads trigger zero spawns and zero provider requests.
- [x] Existing transcript totals are unchanged; no pricing or credit actions added.
- [x] All gates, fixture UI states, docs and index status are complete.

## STOP conditions and maintenance

Stop if quota reporting requires credentials, a new process, provider HTTP calls,
unbounded polling/history, merging accounts without an identity, or writes from
a paired viewer. Stop if SDK payload semantics differ or two attempts fail the
same verification gate. Report live compatibility uncertainty rather than
relaxing fixture assertions or making up a value.

Future provider adapters must supply their own trusted observation semantics;
availability of a token total is not subscription support. Reassess account
identity and invalidation before adding persistent caching or a global meter.
