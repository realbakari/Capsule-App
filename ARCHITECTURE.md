# Capsule Architecture

## 1. Executive Summary

Capsule is a local-first macOS workspace for AI agents. It is not an OpenClaw clone and not a Buzz clone.

OpenClaw owns agent execution. Capsule owns the workspace: projects, conversations, runs, contracts, verification, policies, approvals, artifacts, and a native-feeling desktop UI.

The OpenClaw Gateway is the single source of truth for sessions, routing, and channel connections. Capsule connects to it as an operator client over WebSocket. Buzz and other messaging surfaces reach Capsule only as OpenClaw channels — Capsule never speaks those protocols itself.

Capsule is a TypeScript pnpm workspace, licensed MIT.

---

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CAPSULE                             │
│                    macOS Desktop App                        │
│                                                             │
│     Chat · Projects · Agents · Skills · Code                │
│     Tasks · Runs · Artifacts · Approvals                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ explicit IPC
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Capsule Core                           │
│  Routing · Governance · Workspace · SQLite · Keychain       │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
        OpenClawAdapter                 BuzzAdapter
                │                       (channel map)
                ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                          │
│         WebSocket control plane · protocol 4                │
│         default ws://127.0.0.1:18789                        │
└──────┬──────────────┬──────────────┬────────────────────────┘
       │              │              │
    Agents         Skills          Tools
       │              │              │
       └──────────────┼──────────────┘
                      │
              Browser · Shell · Filesystem
                      │
              External channels (Buzz, Telegram, …)
```

**Key architectural principle:** The Gateway is the control plane. Capsule never imports OpenClaw internals (`src/**`). Integration uses `@openclaw/gateway-client`, `@openclaw/gateway-protocol`, and documented plugin SDK surfaces.

---

## 2. Process Model

Electron main owns everything privileged. The React renderer is a view.

```
Electron Main
│
├── Window management
├── macOS integration
├── OpenClaw connection
├── Capsule engine
├── SQLite
├── Keychain
├── filesystem
├── subprocesses
├── notifications
└── menu bar
       │
       ▼  contextIsolation: true
          nodeIntegration: false
       IPC (explicit methods only)
       │
       ▼
React Renderer
```

There is no `execute(command: string)` IPC. The renderer may call things like `listProjects()`, `sendMessage()`, `getRun()`, and `resolveApproval()`.

---

## 3. Package Map

```
apps/desktop          Electron + React + Vite shell

packages/
  shared              Types, IPC contract, IDs
  core                Engine, pipeline, Keychain adapter
  database            SQLite + migrations
  projects            Project records
  sessions            Conversation records
  agents              Agent presentation models
  skills              Skill catalog
  tools               Tool descriptors
  runs                Run + progress helpers
  policies            Allow / approval / block
  contracts           Machine-readable execution contracts
  verification        Contract checks + evaluation
  artifacts           Run outputs
  filesystem          Project-scoped file access
  terminal            Native terminal open
  openclaw            Gateway adapter + mock runtime
  buzz                Channel mapping only — not the Buzz protocol
  ui                  Shared tokens
```

Cross-package rule: the UI never depends on OpenClaw types. Domain packages depend on `@capsule/shared`. `core` orchestrates. Adapters are the only place that talk to the outside world.

---

## 4. OpenClaw Integration

Current upstream (as of 2026.8):

| Fact | Value |
|------|--------|
| Control plane | Long-running Gateway process |
| Transport | WebSocket, JSON text frames |
| Default bind | `127.0.0.1:18789` |
| Wire version | Protocol **4** (`minProtocol` / `maxProtocol` = 4) |
| Handshake | `connect.challenge` then `connect` |
| Client role | `operator` |
| Scopes | `operator.read`, `operator.write`, `operator.approvals` |
| Capabilities | `tool-events`, `approvals`, `exec-approvals`, `session-scoped-events`, `agent-kind` |
| Packages | `@openclaw/gateway-client@beta`, `@openclaw/gateway-protocol@beta` |
| Plugin boundary | `openclaw/plugin-sdk/*` capability registration |

Frame shapes:

- Request `{ type: "req", id, method, params }`
- Response `{ type: "res", id, ok, payload \| error }`
- Event `{ type: "event", event, payload, seq?, stateVersion? }`

Discovery order: configured URL → `~/.openclaw/openclaw.json` port → `127.0.0.1:18789`. Remote Gateways are a URL change, not a redesign.

If the Gateway is down, Capsule falls back to `MockAgentRuntime` so projects and conversations still work.

---

## 5. Capsule Execution Pipeline

This is Capsule's distinctive layer. OpenClaw does not own it.

```
User request
    → Context (project, session, mode)
    → Route (agent + skill)
    → Contract (required / forbidden)
    → Policy
    → OpenClaw execution (or mock)
    → Verification
    → Evaluation
    → Artifact
    → Result (persisted run + messages)
```

Default UI shows simple progress. Expanding a run shows agent, skill, session, tool calls, contract, policy, events, artifacts, and verification. Replay reconstructs recorded events; it does not pretend model execution is deterministic.

---

## 6. Channels

Buzz is an official OpenClaw channel plugin (`@openclaw/buzz`). Architecture:

```
Buzz room
  → OpenClaw Buzz plugin
  → OpenClaw Gateway
  → Agent
  → Capsule run
```

Capsule shows source metadata (channel, room, thread, sender) and links it to a Capsule run. It does not implement Buzz's Nostr protocol, identity, or authentication.

The same mapping applies to Telegram, Discord, Slack, WhatsApp, and other Gateway channels. Buzz is not a special case in Capsule's type system.

---

## 7. Persistence and Secrets

SQLite holds workspaces, projects, sessions, messages, agents, skills, runs, events, contracts, policies, approvals, artifacts, and channel bindings.

Secrets never go in SQLite or the renderer. Gateway tokens live in macOS Keychain. Tests may use a `0600` file under the user-data directory.

---

## 8. Desktop UI

The desktop shell is inspired by Buzz's conversation workspace: a quiet sidebar of places to work, a message timeline, and a composer dock. Capsule's default view is still “I'm working on it…”, not an enterprise compliance dashboard.

Visual language borrows Buzz's Catppuccin Macchiato dark surface and mauve accent, Inter-style system type, rem-based sizing, and muted sidebar labels. Capsule remains a distinct product.

---

## 9. Known Limitations

| # | Limitation | Detail |
|---|-----------|--------|
| 1 | Monaco / xterm / Git workspace | Phase 4. File list exists; full code workspace does not. |
| 2 | Execution replay UI | Events are stored; a dedicated replay viewer is not shipped. |
| 3 | Device pairing UX | Token + loopback connect work; full Ed25519 pairing UI is incomplete. |
| 4 | Bonjour discovery | Local TCP probe and config-file hints work; mDNS browsing is not wired. |
| 5 | Channel-to-run live ingest | Channel status is listed; inbound Buzz messages are not a live Capsule inbox yet. |
| 6 | Notarization / auto-update | Packaging targets `Capsule.app` / `.dmg` for Apple Silicon; signing is prepared, not configured. |
| 7 | Dual Node/Electron native ABI | `better-sqlite3` is rebuilt for Electron. `pnpm test` runs Vitest under Electron so SQLite loads. |

---

## Related

- [README.md](README.md) — product overview and commands
- [AGENTS.md](AGENTS.md) — conventions for AI contributors
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup and PR expectations
- [docs/openclaw.md](docs/openclaw.md) — Gateway protocol notes for implementers
