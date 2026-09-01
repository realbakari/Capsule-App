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

## What Capsule must not do

- Import `openclaw/src/**`
- Embed or fork the Gateway
- Speak messaging-channel protocols itself
- Treat `hello-ok.features.methods` as a complete method dump

## Discovery

1. Settings URL
2. `~/.openclaw/openclaw.json` `gateway.port` / remote URL
3. `127.0.0.1:18789`

Bonjour (`_openclaw-gw._tcp`) is documented by OpenClaw and not yet consumed.

## Channels

Install channel plugins on the Gateway. Capsule lists them via `channels.status` and traces channel message → OpenClaw session → Capsule run. Private keys stay on the Gateway.
