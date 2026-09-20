# Plan 003: Expose the native Muse reasoning default through Agent settings

> Read this plan fully before implementation. Follow the gates in order and
> update `plans/README.md` only after verification. Do not assume a setting is
> known merely because the native protocol supports changing it.
>
> Drift check: `git diff --stat db8eac6..HEAD -- packages/muse/src/session.ts packages/muse/src/protocol.ts packages/muse/src/session.test.ts packages/muse/src/fixtures/agent.mjs packages/muse/src/configuration.ts packages/muse/src/configuration.test.ts packages/muse/src/optional-query.ts packages/muse/src/optional-query.test.ts packages/core/src/muse-flow.test.ts apps/desktop/src/renderer/src/features/harness/AgentConfiguration.tsx apps/desktop/src/renderer/src/testing/renderer-regressions.tsx apps/desktop/src/renderer/src/testing/muse-settings-regressions.tsx docs/user/providers.md docs/user/composer.md docs/internals/harness.md docs/internals/desktop.md`
> Compare changed code with the current-state excerpts; stop on unexplained drift.

## Status

- Priority: P2
- Effort: M; bounded resume reconciliation is the main uncertainty.
- Risk: MED; presenting the wrong setting is more dangerous than omitting one.
- Confidence: HIGH on the missing control and SDK contract; live CLI behavior is unverified.
- Depends on: none functionally; schedule after the UI plans for review clarity.
- Category: direction
- Planned at: `db8eac65e5ab96efca5f47d4597d235a684c83e6`, 2026-09-20
- Implementation status: DONE — see [verification](verification-2026-09-21.md).

## Why this matters

Capsule's Muse adapter exposes models but omits the native reasoning-default
command. The existing Agent settings surface can carry this setting without a
new protocol, agent loop or global UI preference. The session default affects
future turns; it is unrelated to showing or hiding reasoning text.

## Current state and evidence

- `packages/muse/src/session.ts:179` currently restricts configuration to models:

  ```ts
  const selected = this.modelRows.find((model) => model.modelId === value);
  if (id !== "model" || !selected) throw new Error("Choose a model reported by this Muse session.");
  ```

- `session.ts:236` publishes only a model option. `notification()` handles
  `session/modelChanged` before its active-turn guard. Reasoning notifications
  need the same session-level treatment, not turn-only routing.
- `session.ts:95` resumes with `excludeItems: true`. The pinned SDK's `Session`
  object does **not** contain the reasoning default. It appears in
  `SnapshotState.reasoningEffort` and `session/reasoningEffortChanged` events.
  Do not read an invented `session.reasoningEffort` field.
- Read-only protocol references in
  `packages/muse/node_modules/@muse-code/sdk/dist/src/msp.d.ts`:
  - line 949: eight exact effort strings, including distinct `none` and `max`;
  - line 1277: session-scoped reasoning-change notification;
  - line 1378: `session/setReasoningEffort`, durable on acknowledgement;
  - line 1579: optional snapshot default;
  - line 2232: bounded `view/page` request and ascending event order.
- `packages/muse/src/transport.ts` already caps frames at 4 MiB. The installed
  SDK `Connection.request` has no abort/timeout parameter. Optional metadata
  reads must not create an unbounded series of unresolved requests.
- `apps/desktop/src/renderer/src/features/harness/AgentConfiguration.tsx:6`
  already serves the composer capabilities popover and Harnesses. Its pattern:

  ```ts
  try { await api.setHarnessConfig(sessionId, id, value); }
  catch (failure) { if (active.current) setError(formatUserError(failure)); }
  finally {
    // Refresh even on rejection: the agent may have changed dependent values.
    try { await refreshHarnessStatus(sessionId); }
  ```

- `packages/core/src/engine.ts:1017` rejects exact config changes on Gateway
  sessions; `setHarnessConfig` is already a write-only IPC channel.
- `packages/muse/src/session.test.ts` launches an owned Node fixture, never an
  installed signed-in CLI. `packages/core/src/muse-flow.test.ts` covers native
  routing, transcript persistence and database-reopen resume.

## Scope and boundaries

Only modify these implementation/test files:

- `packages/muse/src/session.ts`, `protocol.ts`, `session.test.ts`, `fixtures/agent.mjs`
- `packages/muse/src/configuration.ts`, `configuration.test.ts` — new pure helpers/tests
- `packages/muse/src/optional-query.ts`, `optional-query.test.ts` — new bounded optional-read helper/tests
- `packages/core/src/muse-flow.test.ts`
- `apps/desktop/src/renderer/src/features/harness/AgentConfiguration.tsx` — only if needed for unknown/pending state accessibility
- `apps/desktop/src/renderer/src/testing/renderer-regressions.tsx`
- `apps/desktop/src/renderer/src/testing/muse-settings-regressions.tsx` — new interaction fixture module
- `docs/user/providers.md`, `docs/user/composer.md`, `docs/internals/harness.md`, `docs/internals/desktop.md`
- This plan and `plans/README.md`

No dependency upgrades, SDK internals, database schema, new IPC, provider HTTP
requests, credentials, global default, turn overrides, automatic retries,
permission changes, runtime loops or changes to other harnesses. Keep Muse on
its native local route even when the application default is Gateway. Remote
viewers may read the current option but cannot change it.

Use small named helpers for effort validation, display options and bounded
history extraction. Avoid compressing new protocol branches into single-line
conditionals. Match existing ESM imports and explicit untrusted-data validation.

## Commands and git workflow

Run from repo root with Node 22+ and pnpm 10. Use the installed SDK 1.3.0 as
read-only evidence; do not update it to make the proposed feature convenient.

| Purpose | Command | Expected result |
| --- | --- | --- |
| Adapter and helper tests | `pnpm test packages/muse` | All protocol fixtures pass |
| Engine integration | `pnpm test packages/core/src/muse-flow.test.ts` | Native route/resume pass |
| Session identity and IPC | `pnpm test apps/desktop/src/renderer/src/lib/harness-status-cache.test.ts packages/shared/src/ipc-scopes.test.ts` | No stale options or viewer writes |
| UI interactions | `pnpm test scripts/renderer-regressions.test.mjs` | Renderer regressions pass |
| Full validation | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` | Each exits 0 |
| Startup | `node scripts/smoke-test.mjs` | Workspace loads and shuts down normally |

Suggested branch: `codex/muse-reasoning-default`. Example commit:
`feat(harness): expose native reasoning defaults`. No attribution trailers or
comparison names. Do not commit/push/release/open a PR without instruction.

## Steps

### 1. Prove the exact wire behavior with fixtures

Add exact validation for the SDK effort vocabulary: `none`, `minimal`, `low`,
`medium`, `high`, `xhigh`, `max`, `ultra`. Invalid strings and booleans must fail
locally. Do not reinterpret `none` as Auto or offer an unset operation that the
native setter does not define. Friendly labels may differ; submitted values may not.

Extend the fixture with native effort changes, rejection, notification-before-
ack, wrong-session notifications and durable reasoning events on `view/page`.
Use a fixture-owned temporary state file when testing process restart; do not
fake durability merely by returning a fixed effort on every new session.
Add pure helper tests for effort validation and history extraction first.

Verification: `pnpm test packages/muse/src/configuration.test.ts` → all helper
tests pass, including the eight exact tiers and malformed history.

### 2. Add acknowledged setting changes and bounded recovery

Split `setConfig` by exact option ID. Keep the model path intact. For
`reasoning_effort`, preserve the existing busy/setting admission guard and send
`session/setReasoningEffort` with the SDK-minted command ID, current session ID
and validated tier. Require a matching accepted acknowledgement for this new
write. Publish the acknowledged value, unless a newer authoritative reasoning
notification arrived during the request. Every accepted write invalidates
recovery reads begun before its acknowledgement, even if no notification arrives.
A rejected/unknown operation leaves
the last known value unchanged and produces an actionable error. Never resend
an uncertain write automatically.

Handle `session/reasoningEffortChanged` before the active-turn guard. Validate
the exact session and tier. Increment a local configuration generation so late
read/ack results cannot overwrite a newer notification. During start/resume,
buffer at most 16 small reasoning notifications until the returned identity is
validated, then retain only that identity's latest valid report. Do not retain
arbitrary event payloads or attach reasoning controls to assistant messages.

Publish a select option through `report.configOptions`, independently of whether
the model list is nonempty. Its description must say it is the session default
for future turns. If unknown, leave `currentValue` absent so the existing UI
shows **Not reported**, not an invented Medium/Auto value.

For resume recovery, keep `excludeItems: true` and read at most one backward
`view/page` of 100 events after identity validation. Consume only the latest
valid reasoning-change event for this session; discard all unrelated history.
Keep the 4 MiB frame cap. If the desired setting is outside this bounded page,
unsupported, missing or malformed, keep it **Not reported**. This limitation
must be documented; do not claim exhaustive history recovery.

Implement the optional read with a separate helper: a 3-second UI deadline,
no transport close solely for this optional timeout, no retry, and at most one
such query per connection for this purpose. The SDK has no request abort: the
single underlying promise may remain until reply/connection close, but cannot
multiply on refresh. Optional recovery must not block publishing the session or
admitting a later configuration write. Apply a recovery result only before its
deadline, while the session is open, and if neither an accepted write nor a
valid reasoning notification has advanced its captured generation. Once timed
out, the query is permanently ineligible to update state, even if its generation
still matches. Handle its eventual rejection without an unhandled promise.
This helper must not weaken mandatory command
timeouts or the transport's framing-error handling.

Verification: `pnpm test packages/muse` → normal/model flows remain passing;
new effort, ordering, timeout and bounded-recovery tests pass. Include a delayed
page → accepted setter without notification → late page case, and a timed-out
page that later resolves without any intervening write. Neither may replace
the displayed state. Then
`pnpm typecheck` → exit 0.

### 3. Verify both UI entry points and route boundaries

Reuse the exact Agent settings option through composer → Conversation tools →
Agent settings and capabilities, and through the selected Harnesses session.
Do not add a second independent settings store or always-visible toolbar control.
Changes must retain draft, selected model and permission state; pending saves
disable conflicting changes; failures display locally. Switching threads during
a pending save must not change the other thread's selector or show its error.

Add interaction fixtures following `testing/panel-regressions.tsx`'s setup and
cleanup pattern. Cover known/unknown values, accepted/rejected saves, session
switching and `isDesktop: false`. Extend the engine fixture to change effort,
restart its disposable database/fixture process and recover the native report.
Assert that control changes add no user/assistant message or run. Other ACP
agents and Gateway sessions must not gain a fabricated native effort option.

Verification: run engine, IPC/cache and renderer commands in the table, then
`pnpm lint` → all pass.

### 4. Document limits and run the whole gate

Update provider/composer user docs and harness/desktop internals. Distinguish
native reasoning effort from the reasoning-display preference, future-turn
application from mid-turn retuning, and bounded recovery from a confirmed
default. Keep the existing statement that fixtures are not live-provider
certification. Do not launch a signed-in agent as part of ordinary tests.

Run the full validation/startup commands. Use only a throwaway profile for UI
screenshots and the mock project → thread → send → run → artifact flow. The
smoke script can seed from `CAPSULE_SMOKE_SEED_DATABASE` using a safe one-way
snapshot. Never launch against the live profile or kill processes by pattern.

Verification: full commands and `git diff --check` exit 0; scoped file list only.

## Done criteria

- [x] All eight exact tiers, wrong-session events and write failures are tested.
- [x] Current values come from acknowledged/native state, never guessed defaults.
- [x] Resume read is bounded; missing history is visibly unknown.
- [x] Accepted writes invalidate older recovery; timed-out results never apply.
- [x] Idle-session notifications update both entry points without a chat message.
- [x] Remote writes remain denied; no native effort setting is invented for other routes.
- [x] Full gates pass; docs/index updated; local-first follow-up scope recorded.

## STOP conditions and maintenance

Stop if the installed SDK differs, the bounded event page cannot be read safely,
runtime recovery requires a full transcript/loop, or a desired UI operation
requires new authority/IPC. Stop after two failed attempts at the same gate.
Do not substitute a persistent Capsule preference for the native default.

Review native acknowledgement/notification ordering on SDK upgrades. Optional
read limits are intentional: expand them only with measured memory bounds and
a separate approved design. A real signed-in smoke test is a separate, explicit
verification step, not something fixture success proves.
