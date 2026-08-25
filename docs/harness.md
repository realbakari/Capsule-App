# Claude Code and Codex harnesses

Buzz's desktop treats Claude Code and Codex as first-class ACP runtimes. Capsule mirrors that product idea on OpenClaw instead of copying Buzz's stdio `buzz-acp` harness.

Capsule owns the workspace: projects, conversations, runs, contracts, approvals, and artifacts. OpenClaw acpx owns the coding loop.

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

## Workspace features Capsule implements (inspired by Buzz / Codex / Claude Code)

Capsule is not a Buzz clone, not Codex, and not Claude Code. It takes the **workspace** pieces those products get right:

- Projects and threads with rename, archive, and delete
- Folder as the coding cwd, git branch/dirty status, file mention (`@path`)
- Plan vs code modes
- Approvals, run timeline, artifacts/diffs
- Claude Code and Codex as ACP harnesses through OpenClaw

It does **not** implement Buzz channels/huddles/Nostr, Codex cloud worktrees, or Claude Code’s IDE/Slack/GitHub surfaces.

## Do you need to install Claude Code in Capsule?

No. Capsule never ships or installs Claude Code or Codex. It **picks them up**:

1. From `PATH` and common install locations on this Mac (`/opt/homebrew/bin`, `~/.local/bin`, a login shell, …).
2. From the OpenClaw Gateway host when acpx is enabled — even if the desktop process cannot see the binary.

If the UI says a CLI is already detected, the remaining step is **start/connect the Gateway**, not another install.

## What Capsule does not do

- Speak ACP JSON-RPC to Claude or Codex over stdio
- Ship `buzz-acp`
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

See [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents) and [Buzz ACP](https://github.com/block/buzz/blob/main/ARCHITECTURE.md).
