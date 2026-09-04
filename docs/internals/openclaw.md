# OpenClaw notes for Capsule

Capsule talks to OpenClaw only through the public Gateway. This page is the implementer cheat-sheet. The product boundary is in [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Packages

Pin the **beta** dist-tag until OpenClaw publishes a non-reserved `latest`:

- `@openclaw/gateway-client@2026.8.1-beta.3`
- `@openclaw/gateway-protocol@2026.8.1-beta.3`

`latest` is currently a `0.0.0` placeholder and will not work.

## Handshake

1. Connect WebSocket to `ws://127.0.0.1:18789` (or configured URL).
2. Wait for `connect.challenge` (`nonce`, integer `ts`).
3. Persist an Ed25519 device identity, sign the challenge-bound payload (`signedAt` = challenge `ts`), and send `connect` with `minProtocol: 4`, `maxProtocol: 4`, `role: "operator"`, plus the shared Gateway token on loopback.
4. Persist `hello-ok.auth.deviceToken` when issued. Never log it.

Capsule identifies as `clientName: cli`, `mode: ui`, `displayName: Capsule`. The Gateway's client-id registry is closed; unknown ids are rejected. Device keys live under the app user-data `identity/` directory (`0600`), not SQLite. Loopback pairing is usually auto-approved; otherwise run `openclaw devices approve <requestId>`.

## Methods Capsule uses

| Method | Why |
|--------|-----|
| `agents.list` | Present OpenClaw agents without duplicating the runtime |
| `sessions.create` / `sessions.send` / `sessions.abort` / `sessions.steer` | Conversations, ACP slash commands, cancellation, steer |
| `sessions.list` / `sessions.subscribe` / `sessions.messages.subscribe` | Roster + live transcript |
| `chat.history` | Reconnect recovery |
| `config.get` / `health` | acpx enablement and `permissionMode`. Do not rely on `plugins.list` — some Gateway builds reject it. |
| `channels.status` | Gateway messaging channels |
| `exec.approval.list` / `exec.approval.resolve` | Host exec approvals |
| `artifacts.download` | Transcript-backed files |

Advertise `tool-events` or live tool streaming never arrives (the handshake still succeeds).

Subscribe to `sessions.messages.subscribe` with `{ key }` **before** sending a
turn. `includeApprovals` is not a supported subscription parameter and causes
validation failure. Only an unknown-method response permits the legacy stream
fallback; other subscription errors surface before the prompt is sent.
`session.message` carries a persisted whole message, not a text delta or a
turn-end event. Only assistant rows supply prose. User and tool rows are ignored.
The message timestamp associates a delayed snapshot with its originating run;
snapshots replace partial buffers and duplicate replies are not appended again.
An empty terminal output or a late send acknowledgement must not erase a reply.
Several assistant snapshots remain separate messages, not a repeated aggregate
on completion. Control output is filtered on both the reply and result paths.

Completed Gateway runs keep their completion status independently of Capsule's
local verification result. Assistant text, including claims that tests passed,
does not count as execution evidence. Saved local checks are explicit desktop
actions, not Gateway RPCs, and certify only the recorded local revision. Direct
ACP runs follow the same rule. No remote-host verification is implied.

## What Capsule must not do

- Import `openclaw/src/**`
- Embed or fork the Gateway
- Speak messaging-channel protocols itself
- Treat `hello-ok.features.methods` as a complete method dump

## Discovery

ACP spawn and cwd tuning resolve local whitespace-containing folder paths at
the adapter boundary, since quoting cannot protect a slash-command token.
Only loopback endpoints may use local private aliases; remote endpoints need
host-side paths. The original project path is not rewritten. See the
[harness transport notes](harness.md) for alias lifetime and tunnel limits.

1. Settings URL
2. `~/.openclaw/openclaw.json` `gateway.port` / remote URL
3. `127.0.0.1:18789`

Bonjour (`_openclaw-gw._tcp`) is documented by OpenClaw and not yet consumed.

## Channels

Install channel plugins on the Gateway. Capsule lists them via `channels.status` and traces channel message → OpenClaw session → Capsule run. Private keys stay on the Gateway.
