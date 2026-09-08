# ACP compatibility map

This is an implementation map, not a claim that every ACP feature is available
in Capsule or every published agent has been tested. The direct route speaks
ACP v1 over stdio. The Gateway route remains an operator client of OpenClaw;
direct-client support does not automatically add a Gateway capability.

## Reference scope

Checked against the published documentation on September 8, 2026: the complete
getting-started guides (introduction, architecture, agents, clients and registry),
the v1 protocol guides and schema reference, plus the v2 overview, migration
guidance and draft announcement. Historical proposals and every external agent's
own documentation are not an exhaustive conformance test.

The [introduction](https://agentclientprotocol.com/get-started/introduction) and
[architecture](https://agentclientprotocol.com/get-started/architecture) place
the coding loop with the agent. The [agent directory](https://agentclientprotocol.com/get-started/agents)
includes native implementations and adapters. A directory entry is not proof
that a particular installed binary or Capsule preset supports a feature.

## Implemented direct-route behavior

| Surface | Capsule behavior | Regression coverage |
| --- | --- | --- |
| Initialization | Require the negotiated v1 version before opening a session; close the owned process if startup fails. | `packages/acp/src/session.test.ts`, `host.test.ts` |
| Session creation | Pass the effective cwd as structured data, including spaces. Do not mutate cwd in a live session. | `packages/acp/src/session.test.ts`, `packages/core/src/trust-boundaries.test.ts` |
| Session restoration | Persist native identity; prefer advertised resume, otherwise supported load. Suppress history replay, retain config, and refuse silent fresh-session fallback. | `packages/core/src/direct-session-recovery.test.ts`, `packages/acp/src/session.test.ts`, `host.test.ts` |
| Rich prompts | Send native images and embedded text/binary resources only with negotiated support, bounded file reads and a final wire budget. | `packages/core/src/direct-prompt.test.ts`, `packages/acp/src/session.test.ts` |
| Live configuration | Set exact reported select/boolean IDs; retain acknowledged snapshots, serialize edits and refresh both UI entry points. | `packages/acp/src/session.test.ts`, renderer runtime-extension regressions |
| Prompts and replies | One active prompt per session. Preserve token chunks; use message IDs where supplied and fallback boundaries otherwise. Persist separate messages and paragraph-separated run results. | `packages/acp/src/session.test.ts`, `packages/core/src/direct-replies.test.ts` |
| Permissions | Select an explicit safe option for a user decision. Cancel unanswered requests on Stop, Close, terminal runs and output-budget failures. Settle callbacks once. | `packages/acp/src/session.test.ts`, `packages/core/src/direct-replies.test.ts`, `trust-boundaries.test.ts` |
| Cancellation | Send `session/cancel`, settle pending approvals, accept final updates, and wait for the prompt to settle. A timeout does not certify that the process stopped. | `packages/acp/src/session.test.ts` |
| Optional HTTP MCP | Offer browser tools only when the handshake explicitly advertises HTTP support. Send required header arrays, including empty arrays. Each owned process receives a revocable credential; page access additionally requires the visible thread's grant. Unsupported transport does not prevent an ordinary prompt. | `packages/acp/src/session.test.ts`, `host.test.ts`, `apps/desktop/src/main/browser-access.test.ts`, `browser-mcp.test.ts` |
| Model reports | Replace config snapshots, including removals. Read flat or grouped choices with bounded retention. Preserve only a separately supplied legacy catalog as fallback. Scope displayed status to the current live session. | `packages/acp/src/session.test.ts`, `packages/shared/src/agent-reports.test.ts`, `harness-capabilities.test.ts` |
| Reported usage | Retain validated context snapshots and reported turn counters separately from transcript-based estimates. Missing data is not zero. | `packages/shared/src/agent-reports.test.ts`, `packages/core/src/trust-boundaries.test.ts` |

The [v1 reference](https://agentclientprotocol.com/protocol/v1/schema) defines
these wire shapes. Local bounds are implementation limits, not limits imposed
on agents by the protocol. See [retained output](harness.md#completion-and-retained-output).

## Not carried, or only partially carried

- **Protocol-driven authentication and registry installation.** Users install
  and sign in through their CLI. Capsule does not implement `authenticate`,
  `logout`, terminal authentication, or automatic registry installation.
- **Additional direct session lifecycle.** Native resume/load is implemented;
  agent-side list and delete remain unavailable. Capsule's Close ends its owned process; it is not a
  protocol `session/close` request.
- **Legacy live settings and policy mapping.** Config options drive direct
  settings; legacy model catalogs alone do not enable a mutation. Generic
  Capsule permission profiles are not mapped to agent policy values. The
  Gateway has its own documented operator controls.
- **Client execution APIs.** Direct initialization does not advertise ACP file
  reads/writes, terminal execution or elicitation. Unknown requests receive an
  unsupported-method error instead of hanging. Workspace file and terminal UI
  are separate capabilities, not implementations of those ACP methods.
- **Additional rich content and live plans.** Native images and embedded resources
  are sent when supported. Dedicated native audio prompts are not implemented.
  Tool activity retains title/status and selected bounded metadata, not every
  rich result. Plans, dynamic command advertisements and session-info updates
  do not yet drive dedicated UI. Message IDs separate streamed replies; they do
  not implement history replay, edits or protocol-ID-based deduplication.
- **Browser automation.** The optional MCP tools cover status, navigation,
  bounded snapshots, reference-based click/type/select/key actions, scrolling,
  viewport screenshots and recent diagnostics. References belong to a snapshot
  in the guest's isolated world. The visible thread must grant access; switching
  threads or hiding the panel revokes it. Explicit background pages use separate
  temporary profiles and grants; they can share read-only snapshots with paired
  viewers. Arbitrary evaluation, uploads, recording, sign-in profile imports and
  interactive remote control remain unavailable. Foreground cookies remain in a
  shared browser partition, not a per-thread identity store. Gateway browser setup is Gateway-owned. These are
  MCP tools, not ACP client-execution methods. See [browser tools](harness.md).
- **Full wire validation.** The parser projects supported fields and tolerates
  older agents; it is not a generated validator for the entire ACP schema.

## Protocol v2 is a separate change

The [v2 documentation](https://agentclientprotocol.com/protocol/v2/overview)
is draft. Its prompt response acknowledges acceptance rather than completion;
state updates, capability shapes, message updates and tool diffs differ from
v1. Simply accepting version 2 would misreport turn completion. Any future v2
work must keep v1 working, negotiate explicitly, and test a separate adapter
against the [migration guide](https://agentclientprotocol.com/protocol/v2/migration).
