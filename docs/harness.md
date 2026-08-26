# ACP harnesses

Capsule owns the workspace: projects, conversations, runs, contracts, approvals, and artifacts. OpenClaw acpx owns the coding loop. Capsule never ships or installs Claude Code, Codex, or any other ACP CLI.

See [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents) and [setup](https://docs.openclaw.ai/tools/acp-agents-setup).

## Lifecycle Capsule implements

| Action | What Capsule does |
|--------|-------------------|
| **Doctor** | Probe the CLI on `PATH`, Gateway reachability, and the `acpx` plugin. When connected, send `/acp doctor` (and `/acp install` if acpx is missing). |
| **Dedicate** | Set the project's default coding agent. Code-mode sends route through that harness. |
| **Spawn** | `sessions.create`, then `/acp spawn <id> --bind off --mode persistent\|oneshot --cwd <dir>`. Follow-ups go to the returned `agent:<id>:acp:<uuid>` session. `--bind here` is for messaging channels, not the Capsule operator socket. |
| **Work** | Follow-up prompts go to the bound ACP session. Gateway commands (`/acp`, `/status`) stay local. |
| **Steer** | `sessions.steer` when the Gateway supports it, otherwise `/acp steer`. |
| **Cancel** | `sessions.abort` plus `/acp cancel` for the in-flight turn. Binding stays. |
| **Status** | `/acp status` — backend, mode, state, model, cwd, permissions, timeout. |
| **Tune** | `/acp permissions`, `/acp model`, `/acp cwd`, `/acp timeout`, `/acp set-mode`. |
| **Close** | `/acp close` — ends the ACP session and unbinds. Capsule keeps the conversation history. |

`sessions.create` does **not** accept `runtime: "acp"`. `sessions_spawn({ runtime: "acp" })` is an agent tool, not a Gateway session-create field.

## Official acpx targets

Claude Code and Codex are first-class in Capsule. These ids are also valid `/acp spawn` targets: `copilot`, `cursor`, `droid`, `fast-agent`, `gemini`, `iflow`, `kilocode`, `kimi`, `kiro`, `mux`, `opencode`, `openclaw`, `qoder`, `qwen`, `trae`.

`pi` is registered in acpx but is not treated as a coding harness here.

Codex has two OpenClaw routes. Native `/codex` is preferred when the Codex plugin is enabled. Capsule spawn of Codex is the **explicit ACP** path (`/acp spawn codex`).

## Workspace

- Projects and threads with rename, archive, pin, and delete
- Folder as the coding cwd, git branch/dirty status, file mention (`@path`)
- Slash commands (`/`), skills (`$`), plan vs code modes
- Per-thread permission mode (supervised / standard / full access)
- Approvals, run timeline, artifacts
- ACP harnesses through OpenClaw acpx

ACP sessions run on the Gateway host. OpenClaw sandbox policy does not wrap them. There is no TTY, so Capsule never pretends to ask:

- **Standard / Full access** → `plugins.entries.acpx.config.permissionMode=approve-all` (and `/acp permissions approve-all` on the session). Coding harnesses cannot write or fetch without this.
- **Supervised** → `deny-all`. Tools that would need a prompt are refused.
- If OpenClaw later forwards `session/request_permission` on the operator socket, Capsule maps it to Approvals. Until that exists, plugin config is the real switch. Old ACP workers keep the flags they started with — restart the Gateway after changing them.

## Do you need to install Claude Code in Capsule?

No. Capsule **picks them up**:

1. From `PATH` and common install locations on this Mac (`/opt/homebrew/bin`, `~/.local/bin`, a login shell, …).
2. From the OpenClaw Gateway host when acpx is enabled — even if the desktop process cannot see the binary. acpx may fetch adapters on first use.

If the UI says a CLI is already detected, the remaining step is **start/connect the Gateway**, not another install.

## What Capsule does not do

- Speak ACP JSON-RPC to a harness over stdio
- Install any coding CLI inside the app
- Replace OpenClaw's native Codex plugin (`/codex bind`)
- Own Discord/Telegram ACP channel bindings (those stay in Gateway config)

## Operator setup

```bash
# On the Gateway host
openclaw plugins install @openclaw/acpx
openclaw config set plugins.entries.acpx.enabled true
# If plugins.allow is set, it must include acpx

# Required for write/exec/network in non-interactive ACP sessions
openclaw config set plugins.entries.acpx.config.permissionMode approve-all
openclaw config set plugins.entries.acpx.config.nonInteractivePermissions deny
openclaw gateway restart

# On this Mac
# Install and authenticate Claude Code, Codex, Gemini, …
```

Then in Capsule: **Runtimes → Doctor / Dedicate / Spawn**. Code-mode messages on a dedicated project auto-spawn ACP if no live session exists.
