# Capsule Architecture

## 1. Executive Summary

Capsule is a local-first macOS workspace for AI agents.

Coding CLIs own agent execution. Capsule owns the workspace: projects, conversations, runs, contracts, verification, policies, approvals, artifacts, and a native-feeling desktop UI. The Gateway route delegates to OpenClaw; direct mode is a thin native-CLI ACP client, not a model or tool loop.

The OpenClaw Gateway owns its sessions and channel connections. Capsule connects to it as an operator client over WebSocket. Direct sessions belong to the local ACP host; a thread keeps the route encoded in its session key. Messaging surfaces reach Capsule only as Gateway channels — Capsule never speaks those protocols itself.

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
              External channels (Telegram, Discord, …)
```

The diagram shows the Gateway route. Direct turns instead follow Core → `DirectAcpHost` → native CLI over stdio. **Key architectural principle:** Capsule never imports OpenClaw internals (`src/**`). Gateway integration uses `@openclaw/gateway-client`, `@openclaw/gateway-protocol`, and documented plugin SDK surfaces.

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

There is no unrestricted main-process RPC bridge. Named capabilities include project command execution and interactive terminals; handlers enforce local command policy. Read-only paired devices cannot call them. The renderer also calls `listProjects()`, `sendMessage()`, `getRun()`, and `resolveApproval()`.

The renderer is a feature-split shell (sidebar, conversation, composer, inspector, runtimes), not a single view file. Tokens live in `@capsule/ui`. The renderer may import types from `@capsule/shared` but must not import Node APIs.

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
  skills              Skill catalog & packs (skills.sh API client, packed procedural instructions)
  tools               Tool descriptors
  runs                Run + progress helpers
  policies            Allow / approval / block
  contracts           Machine-readable execution contracts
  verification        Contract checks + evaluation
  artifacts           Run outputs
  filesystem          Project-scoped file access
  terminal            Project commands, native terminal open, embedded PTY
  acp                 Native CLI ACP stdio client and direct session host
  openclaw            Gateway adapter + mock runtime
  harness             Claude Code / Codex / Grok ACP lifecycle (doctor, spawn, steer, cancel, close)
  buzz                Gateway channel mapping
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
| Handshake | `connect.challenge` then signed Ed25519 `connect` |
| Client role | `operator` |
| Scopes | `operator.read`, `operator.write`, `operator.approvals`, `operator.admin` |
| Capabilities | `tool-events`, `approvals`, `exec-approvals`, `session-scoped-events`, `agent-kind` |
| Packages | `@openclaw/gateway-client@beta`, `@openclaw/gateway-protocol@beta` |
| Plugin boundary | `openclaw/plugin-sdk/*` capability registration |

Frame shapes:

- Request `{ type: "req", id, method, params }`
- Response `{ type: "res", id, ok, payload \| error }`
- Event `{ type: "event", event, payload, seq?, stateVersion? }`

Discovery order: configured URL → `~/.openclaw/openclaw.json` port → `127.0.0.1:18789`. Remote Gateways are a URL change, not a redesign.

An unavailable Gateway is reported, not silently replaced with mock execution. Tests select `MockAgentRuntime` explicitly with `autoConnect: false`. Direct-capable harnesses can work without a Gateway when the configured route selects direct mode.

### Dedicated coding harnesses (ACP via acpx)

On the Gateway route, Capsule is an operator client for OpenClaw acpx:

```
Capsule UI  →  dedicate / spawn
                 ↓
           OpenClaw Gateway
                 ↓
           @openclaw/acpx
                 ↓
        Claude Code, Codex, Grok Build, Gemini, Cursor, …
```

Operator spawn creates a Gateway session, then sends `/acp spawn <id> --bind off --mode persistent|oneshot --cwd <dir>`. The cwd is the conversation's Git worktree when isolation is enabled, otherwise the project folder. That is the operator path from [ACP agents](https://docs.openclaw.ai/tools/acp-agents). `--bind here` is for messaging channels, not Capsule’s operator socket. `sessions_spawn({ runtime: "acp" })` is an agent tool, not a `sessions.create` field — Gateway protocol 4 rejects `runtime` on `sessions.create`.

Claude Code, Codex, and Grok Build are first-class. Grok's native `grok agent stdio` command is registered as a custom acpx agent before Doctor or Spawn. Other official acpx ids (Copilot, Cursor, Droid, Gemini, OpenCode, …) are spawnable from Runtimes. Codex ACP is the explicit fallback; native `/codex` stays on the Gateway when that plugin is enabled.

Gateway ACP harnesses run on the Gateway host, not inside the OpenClaw sandbox. Direct mode speaks ACP JSON-RPC over stdio to an installed native ACP CLI on this Mac. Neither route installs coding CLIs or implements their model/tool loop.

---

## 5. Capsule Execution Pipeline

This is Capsule's distinctive layer. OpenClaw does not own it.

```
User request
    → Context (project, session, mode)
    → Route (agent + skill)
    → Contract (required / forbidden)
    → Policy
    → Gateway or direct CLI execution (explicit mock in tests)
    → Verification
    → Evaluation
    → Artifact
    → Result (persisted run + messages)
```

Default UI shows simple progress. Expanding a run shows agent, skill, session, tool calls, contract, policy, events, artifacts, and verification. Replay reconstructs recorded events; it does not pretend model execution is deterministic.

---

## 6. Channels

Gateway channel plugins (messaging rooms, Telegram, Discord, Slack, WhatsApp, and others) reach Capsule the same way:

```
Channel room
  → OpenClaw channel plugin
  → OpenClaw Gateway
  → Agent
  → Capsule run
```

Capsule shows source metadata (channel, room, thread, sender) and links it to a Capsule run. It does not speak those channel protocols, hold their identities, or store their private keys.

---

## 7. Persistence and Secrets

SQLite holds workspaces, projects (including saved project actions and custom
icon paths), sessions (including local/worktree cwd selection and pinned
ordering), messages (including validated local-file attachment metadata),
agents, skills, runs, events, contracts, policies, approvals, artifacts, and
channel bindings. Unsent drafts and prompt stashes are renderer-local
preferences, not Gateway sessions. Live project-action processes and their
bounded output are intentionally in memory; they stop with the app.

Secrets never go in SQLite or renderer settings. Gateway and catalog tokens use a `0600` file encrypted with Electron safeStorage when available, backed by the macOS Keychain. The adapter has a plaintext fallback when encryption is unavailable. Capsule's Ed25519 device identity and issued device tokens live as `0600` files under the user-data `identity/` directory.

---

## 8. Desktop UI

The desktop shell is a compact agent workspace. Details and shortcuts live in [docs/internals/desktop.md](docs/internals/desktop.md) — update that file in the same change as the UI.

- 52px titlebar (Electron drag region, **no app mark**). Hide-sidebar control is a no-drag child next to the traffic lights (`⌘B`). Two-finger swipe hides the sidebar; a left-edge swipe shows it.
- Collapsible resizable sidebar: project/thread **name only** (no folder paths), discovered/custom project icons, ordered pinned threads, portaled `···` menu, native right-click menu.
- Centered chat column, glass composer (local-file attachments, durable drafts,
  prompt stash, `/`, `@`, `$`, permission, folder basename chip). Transcript is
  turns, not an Artifacts / run-result dump.
- Inspector closed until asked (`⌘\`). Tools: Launch, Review (git), Terminal
  (command runner, not PTY), Browser (validated local-server discovery plus a
  sandboxed HTTP(S)-only Electron guest), Files (expandable tree + image/code
  preview), Side chat (ACP sessions).
- The separate xterm terminal dock is a PTY. Hiding it or visiting Settings preserves its shell; each folder owns its panes. Explicit close or app shutdown ends the process. It is distinct from the Inspector command runner.
- Inbox is the projectless container (`~/Documents/Capsule`). A project has a primary folder plus optional extra folders (`extra_folders`, schema v6). Git projects may give a conversation its own `git worktree`; all conversation I/O resolves against that cwd.
- The titlebar owns contextual project actions: saved commands, Open, Initialize Git, and branch state.
- Settings: General, Appearance, Agents, Gateway, Projects, Source control, Skills, Shortcuts, Diagnostics, About.

Visual language is graphite and off-white, matching the Capsule mark. No purple accent. System type, rem-based sizing, muted sidebar labels. Capsule's default view is still “I'm working on it…”, not an enterprise compliance dashboard.

---

## 9. Known Limitations

| # | Limitation | Detail |
|---|-----------|--------|
| 1 | Editor / direct controls | Files has a conflict-aware editor, not Monaco. Direct sessions do not support live tuning or steer; failed changes are not persisted. |
| 2 | Execution replay UI | Events are stored; a dedicated replay viewer is not shipped. |
| 3 | Remote pairing UI | Loopback auto-approves Capsule's persisted Ed25519 identity; remote/non-local pairing still needs `openclaw devices approve`. |
| 4 | Bonjour discovery | Local TCP probe and config-file hints work; mDNS browsing is not wired. |
| 5 | Channel-to-run live ingest | Channel status is listed; inbound channel messages are not a live Capsule inbox yet. |
| 6 | Release assurance | Apple Silicon packaging supports signing/notarization with configured credentials and an unsigned fallback. In-place updates require a compatible build/feed; verify each release artifact. |
| 7 | Dual Node/Electron native ABI | `better-sqlite3` is rebuilt for Electron. `pnpm test` runs Vitest under Electron so SQLite loads. |

---

## Related

- [README.md](README.md) — product overview and commands
- [AGENTS.md](AGENTS.md) — conventions for AI contributors
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup and PR expectations
- [docs/internals/desktop.md](docs/internals/desktop.md) — desktop product spec (keep in lockstep with the UI)
- [docs/internals/harness.md](docs/internals/harness.md) — ACP harness lifecycle and permissions
- [docs/internals/openclaw.md](docs/internals/openclaw.md) — Gateway protocol notes for implementers
