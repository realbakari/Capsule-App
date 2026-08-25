# Claude Code and Codex harnesses

Capsule owns the workspace: projects, conversations, runs, contracts, approvals, and artifacts. OpenClaw acpx owns the coding loop. Capsule never ships or installs Claude Code or Codex.

## Lifecycle Capsule implements

| Action | What Capsule does |
|--------|-------------------|
| **Doctor** | Probe `claude` / `codex` on `PATH`, Gateway reachability, and the `acpx` plugin. When connected, send `/acp doctor`. |
| **Dedicate** | Set the project's default coding agent to Claude or Codex. Code-mode sends route through that harness. |
| **Spawn** | Create or bind an OpenClaw session and send `/acp spawn <id> --bind here --mode persistent --cwd <dir>`. |
| **Work** | Follow-up prompts go to the bound ACP session. |
| **Steer** | `sessions.steer` when the Gateway supports it, otherwise `/acp steer`. |
| **Cancel** | `sessions.abort` plus `/acp cancel` for the in-flight turn. Binding stays. |
| **Status** | `/acp status` — backend, mode, state, model, cwd. |
| **Permissions / model / cwd** | `/acp permissions`, `/acp model`, `/acp cwd`. |
| **Close** | `/acp close` — ends the ACP session and unbinds. Capsule keeps the conversation history. |

Spawn prefers `sessions.create` with the `/acp spawn` command as the first message (valid against Gateway protocol 4). Capsule does **not** pass illegal `runtime: "acp"` fields on `sessions.create`.

## Workspace

- Projects and threads with rename, archive, pin, and delete
- Folder as the coding cwd, git branch/dirty status, file mention (`@path`)
- Slash commands (`/`), skills (`$`), plan vs code modes
- Per-thread permission mode (supervised / standard / full access)
- Approvals, run timeline, artifacts
- Claude Code and Codex as ACP harnesses through OpenClaw

## Do you need to install Claude Code in Capsule?

No. Capsule **picks them up**:

1. From `PATH` and common install locations on this Mac (`/opt/homebrew/bin`, `~/.local/bin`, a login shell, …).
2. From the OpenClaw Gateway host when acpx is enabled — even if the desktop process cannot see the binary.

If the UI says a CLI is already detected, the remaining step is **start/connect the Gateway**, not another install.

## What Capsule does not do

- Speak ACP JSON-RPC to Claude or Codex over stdio
- Install Claude Code or Codex inside the app
- Replace OpenClaw's native Codex plugin (`/codex bind`) — dedicated Codex in Capsule is the explicit ACP path

## Operator setup

```bash
# On the Gateway host
openclaw plugins install @openclaw/acpx
openclaw config set plugins.entries.acpx.enabled true

# On this Mac
# Install and authenticate Claude Code and/or the Codex CLI
```

Then in Capsule: **Runtimes → Doctor / Dedicate / Spawn**. Code-mode messages on a dedicated project auto-spawn ACP if no live session exists.

See [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents).
