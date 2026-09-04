# ACP harnesses

Capsule owns the workspace: projects, conversations, runs, contracts, approvals, and artifacts. OpenClaw acpx owns the coding loop. Capsule never ships or installs Claude Code, Codex, Grok Build, or any other ACP CLI.

See [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents) and [setup](https://docs.openclaw.ai/tools/acp-agents-setup).

## Lifecycle Capsule implements

| Action | What Capsule does |
|--------|-------------------|
| **Doctor** | Probe the CLI on `PATH`, Gateway reachability, and the `acpx` plugin. When connected, send `/acp doctor` (and `/acp install` if acpx is missing). |
| **Dedicate** | Set the project's default coding agent. Code-mode sends route through that harness. |
| **Spawn** | `sessions.create`, then `/acp spawn <id> --bind off --mode persistent\|oneshot --cwd <dir>`. `<dir>` is the conversation worktree when one exists, otherwise the project folder. Follow-ups go to the returned `agent:<id>:acp:<uuid>` session. `--bind here` is for messaging channels, not the Capsule operator socket. |
| **Work** | Follow-up prompts go to the bound ACP session. Gateway commands (`/acp`, `/status`) stay local. |
| **Steer** | `sessions.steer` when the Gateway supports it, otherwise `/acp steer`. |
| **Cancel** | `sessions.abort` plus `/acp cancel` for the in-flight turn. Binding stays. |
| **Status** | `/acp status` — backend, mode, state, model, advertised model catalog, cwd, permissions, timeout. |
| **Tune** | `/acp permissions`, `/acp model`, `/acp cwd`, `/acp timeout`, `/acp set-mode`. Advertised models become a selector; other agents retain a free-form model id. |
| **Close** | `/acp close` — ends the ACP session and unbinds. Capsule keeps the conversation history. |

`sessions.create` does **not** accept `runtime: "acp"`. `sessions_spawn({ runtime: "acp" })` is an agent tool, not a Gateway session-create field.

The Gateway slash parser splits on whitespace without shell unquoting. For
loopback Gateways, the adapter resolves whitespace-containing cwd values to
stable symlinks under a private `~/.capsule-acp-cwd` directory before spawn or
targeted `/acp cwd`. Links are keyed by the canonical directory path, checked
before reuse, and never overwrite existing entries. They stay across app
restarts because Gateway sessions may outlive Capsule. If the home path itself
contains whitespace, a per-user temporary directory is used instead; clearing
that directory requires respawning the session to recreate its alias.

Project/thread/checkpoint paths remain original; only the slash-command cwd
changes. This is transport adaptation, not a replacement runtime or a Gateway
patch. All Gateway harness presets share it. Direct sessions already pass cwd
as structured data and do not use aliases. Non-loopback Gateways receive no
local alias: whitespace paths fail before session creation with guidance to
use a host-side alias. A loopback tunnel also needs an alias on the actual host;
Capsule cannot provision one remotely.

Operator acknowledgements are not assistant replies. The cancellation guard
checks individual frames, the assembled reply, and completed run output on
both runtime routes. The renderer hides previously stored cancellation notices
without rewriting the database; agent prose discussing cancellation is retained.

Status refreshes after model selection update only the session-keyed renderer
cache. The raw `HarnessLiveStatus.statusText` is diagnostic data, shown only in
the selected session's collapsed Harnesses disclosure, never a global chat
banner. This presentation rule applies to Gateway and direct routes and every
harness. Full stored status reports are hidden from assistant history too;
user-pasted reports and explanations are not removed.

## Official acpx targets

Claude Code, Codex, and Grok Build are first-class in Capsule. These ids are also valid built-in `/acp spawn` targets: `copilot`, `cursor`, `droid`, `fast-agent`, `gemini`, `iflow`, `kilocode`, `kimi`, `kiro`, `mux`, `opencode`, `openclaw`, `qoder`, `qwen`, `trae`.

`pi` is registered in acpx but is not treated as a coding harness here.

Codex has two OpenClaw routes. Native `/codex` is preferred when the Codex plugin is enabled. Capsule spawn of Codex is the **explicit ACP** path (`/acp spawn codex`).

Grok Build exposes native ACP over `grok agent stdio`. Because `grok` is not a
built-in alias in every acpx release, Doctor and Spawn register this Gateway
mapping before use:

```json
{
  "plugins": {
    "entries": {
      "acpx": {
        "config": {
          "agents": {
            "grok": { "command": "grok", "args": ["agent", "stdio"] }
          }
        }
      }
    }
  }
}
```

If `acp.allowedAgents` is explicitly configured, Capsule preserves the existing
entries and adds `grok`. It does not create an allowlist when none exists. The
normal operator lifecycle remains `/acp spawn grok --bind off`; Capsule does not
open or proxy Grok's stdio transport itself.

Model lists are capability-driven, not hard-coded per vendor. OpenClaw's status
text includes acpx `runtimeDetails`; Capsule reads the model configuration option
and its grouped or flat choices when present. A harness that exposes only the
current model still works through `/acp model <id>`, but the UI does not invent a
catalog it cannot verify.

## Workspace

Turn verification is a workspace capability shared by every harness and both
Gateway/direct routes. A runtime completion or tool-status message is not a
test receipt. Only an explicitly selected saved local action supplies an exit
code and pre/post revision evidence. Remote Gateway files are not certified by
a local check. No model/provider loops or ACP protocol methods were added for
verification; see [Checking a turn](../user/verification.md).

Gateway harness replies use the persisted assistant-message subscription in
addition to legacy prose streams. Slim ACP tool/lifecycle telemetry is not an
answer. Whole snapshots are deduplicated and associated with the turn by their
timestamp, including after completion. Direct mode continues to deliver prose
from its stdio route; both routes preserve that prose when a completion frame
contains no output. No session loop or transport is replaced by this handling.

- Projects and threads with rename, archive, pin, and delete
- Folder as the coding cwd, git branch/dirty status, file mention (`@path`)
- Optional per-conversation Git worktree isolation; ACP always receives the resolved thread cwd
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
# Install and authenticate Claude Code, Codex, Grok Build, Gemini, …
```

Then in Capsule: **Runtimes → Doctor / Dedicate / Spawn**, or Inspector **Side chat**. Code-mode messages on a dedicated project auto-spawn ACP if no live session exists. The composer also blocks a known-unready harness before send and links directly to Doctor.

Desktop chrome (inspector, folders, shortcuts) is specified in [desktop.md](desktop.md).
