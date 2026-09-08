# ACP harnesses

Capsule owns the workspace: projects, conversations, runs, contracts, approvals, and artifacts. Coding CLIs own their loops, reached through OpenClaw acpx or a thin direct ACP client. Capsule never ships or installs coding CLIs.

See [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents) and [setup](https://docs.openclaw.ai/tools/acp-agents-setup).
The [ACP compatibility map](acp-compatibility.md) distinguishes implemented
behavior from optional protocol surfaces that Capsule does not carry.

## Gateway lifecycle Capsule implements

Switching harnesses must not carry `modelOverride` from the previous harness.
Session creation uses the new harness's default unless that harness was already
selected. Unsupported direct-session option changes remain explicit errors;
they do not mutate the saved selection. Project-skill resolution, inspection and
submission share project/thread context and the thread's actual working folder
on both routes. A missing selected skill fails before recording a user message.

Both runtime routes compact recorded diagnostic events before database and IPC
publication. Raw incoming replies still feed authoritative message/result
handling; the diagnostic size limit must not truncate the actual agent reply.
The paged run log and recent-window labels describe this distinction in the UI.

Assistant prose never determines a run's failure status. Both routes use runtime
lifecycle outcomes; command-text failure classification stays in the Gateway
adapter's actual control requests. Direct replies and results do not use the
legacy Gateway status-dump heuristic, so an agent can quote diagnostics without
losing its answer. Startup cancels all interrupted runs, including
`approval_required`, and settles persisted pending approvals as cancelled on
both routes. No approval callback survives the process that created it.

| Action | What Capsule does |
|--------|-------------------|
| **Doctor** | Probe the CLI on `PATH`, Gateway reachability, and the `acpx` plugin. When connected, send `/acp doctor` (and `/acp install` if acpx is missing). |
| **Dedicate** | Set the project's default coding agent. Code-mode sends route through that harness. |
| **Spawn** | `sessions.create`, then `/acp spawn <id> --bind off --mode persistent\|oneshot --cwd <dir>`. `<dir>` is the conversation worktree when one exists, otherwise the project folder. Follow-ups go to the returned `agent:<id>:acp:<uuid>` session. `--bind here` is for messaging channels, not the Capsule operator socket. |
| **Work** | Follow-up prompts go to the bound ACP session. Gateway commands (`/acp`, `/status`) stay local. |
| **Steer** | `sessions.steer` when the Gateway supports it, otherwise `/acp steer`. |
| **Cancel** | `sessions.abort` plus `/acp cancel` for the in-flight turn. Binding stays. |
| **Status** | `/acp status` — backend, mode, state, model, advertised model catalog, cwd, permissions, timeout. |
| **Tune** | `/acp permissions`, `/acp model`, `/acp timeout`, `/acp set-mode`. Advertised models become a selector; others retain a free-form model id. Engine refuses live cwd changes rather than rewriting the project. |
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
Gateway operator lifecycle remains `/acp spawn grok --bind off`. In direct mode,
Capsule instead opens Grok's native ACP stdio transport on this Mac.

Model lists are capability-driven, not hard-coded per vendor. OpenClaw's status
text includes acpx `runtimeDetails`; Capsule reads the model configuration option
and its grouped or flat choices when present. A harness that exposes only the
current model still works through `/acp model <id>`, but the UI does not invent a
catalog it cannot verify.

The composer groups agent selection and reported model choices into one picker.
Missing or immutable model choices carry a disabled reason inside the menu.
`harnessCapabilities` uses the existing thread's key, not its harness's current
route default, and ignores model catalogs from another session. Direct
permissions display as agent-managed, with no local setting mutation. A compact
capability disclosure, Harnesses detail, the command palette and Browser expose
the same route limitations; none of these affordances adds runtime support.

## Workspace

### Direct sessions

Presets with `acpxCommand` can use the direct route; others keep the Gateway.
The `direct:acp:` key is authoritative for existing sessions regardless of later
settings. Readiness and Doctor probe the local CLI/login without requiring a
Gateway or acpx. Start is available in the composer and Harnesses alike.
Initialization must select ACP protocol version 1 before `session/new` is sent.
Missing, malformed, or unsupported versions fail startup with a compatibility
error; the host closes only that failed session's owned process.

Direct text and tool activity feed the owning run. Permission requests are
persisted and delivered to Approvals; callbacks are exactly-once, approve-once
or deny for user decisions. An absent/unknown denial option cancels rather than
selecting an allow option. No consumer, a terminal run, Stop, Close, and output
budget failure resolve unanswered requests with ACP's `cancelled` outcome, not
a selected rejection option. Core records these approvals as `cancelled`;
explicit Deny remains `denied`. Requests arriving while cancellation is pending
are cancelled without reopening an approval. Late callbacks cannot answer twice.
Approval records settle when Stop or Close is requested, before waiting for
the agent. They stay cancelled even if process cancellation times out; that
timeout still leaves the run unconfirmed. Shutdown settles them before closing
the database.
Cancellation settles pending requests and waits for the active prompt to end;
timeout does not pretend the process stopped. Close terminates only the owned
child and awaits exit. Terminal run records reject late frames.

Migration 17 stores the native session ID together with harness, resolved cwd and
preset launch signature in `sessions.direct_session`. Recovery clears stale
process keys but retains this identity. The next spawn prefers advertised
`session/resume`, otherwise `session/load` when `loadSession` is true. Both receive
the current MCP offer and exact saved ID/cwd. History/permission replay is ignored
while restoring; configuration updates are retained. Unsupported or rejected
restoration never falls back to `session/new`. A different folder, harness or
launch command cannot reuse the identity. Legacy threads without native IDs
cannot restore missing history. No agent session enumeration/delete is added.

Direct select and boolean settings use `session/set_config_option` with exact
reported IDs and values. A boolean request includes its type discriminator.
Responses replace the complete configuration unless a newer notification arrived
during the request; mismatched acknowledgement fails visibly. One setting request
may be pending per process. Model/mode conveniences map only reported categories;
generic permission profiles and timeouts are not guessed. Settings appear in
Capabilities in both Composer and Harnesses. Config notifications refresh status
without making chat messages and are coalesced to at most four notices per second.
Steer and live cwd changes remain unavailable. Cwd changes are refused for both routes.
Both routes reject overlapping turns and share local verification rules below.

Direct prompts send native images or embedded text/blob resources only when the
handshake advertises matching support. Main reopens explicitly attached regular
files using bounded descriptor reads: eight files, 2 MiB/file and just under
3 MiB combined raw bytes including text, then a final 4 MiB wire check including
JSON/base64 overhead. Unsupported, special, missing and oversized files fail the
turn instead of silently substituting paths. Encoded bytes are not persisted.
Gateway delivery keeps its existing bridge and host semantics.

### Embedded browser tools

The desktop offers direct sessions an authenticated loopback HTTP MCP server.
Availability requires `mcpCapabilities.http === true` in the installed CLI's
handshake. False, missing or malformed support omits the optional HTTP tools
while keeping the conversation usable. Gateway browser setup remains
Gateway-owned; Capsule does not inject these tools on that route.

Each native process receives a separate revocable token. The host disposes it
on handshake failure, process exit and explicit close. A token resolves only
the matching Capsule thread's Browser panel. The user must enable **Allow agent
control** there; switching threads, hiding the inspector, leaving Chat or
closing the panel revokes access. Browser cookies are still shared within the
isolated foreground browser partition: thread targeting is not a private-profile feature.

An explicit desktop `controlBackgroundBrowser` call can start one temporary hidden
BrowserWindow per thread, capped at four pages with a fixed 30-minute expiry.
Each uses a distinct non-persistent partition and the same page security rules.
Background grants survive panel changes but are harness-scoped and revoked by
owned-process disposal. While a background page exists, the agent targets it;
an ungranted page fails closed rather than falling back to the foreground.
Starting/changing background controls revokes foreground access.

Desktop-only inspection and page mutations are write-scoped IPC. The separate
read-scoped `readSharedBrowser` returns only explicitly shared snapshots, never
private URLs/pixels. Capture is coalesced, cached for one second and invalidated
by navigation, grants, close and crashes; an epoch check rejects in-flight stale
captures. The renderer requests frames every two seconds only while expanded,
visible and active. Remote clients can neither create nor operate the page.

The implemented tools are status, HTTP(S) navigation, bounded DOM snapshots,
click, text replacement, select-option choice, key press, vertical scroll,
viewport screenshot and on-demand page diagnostics. DOM refs require the
latest snapshot ID and live element identity. Navigation, replacement snapshots,
changed labels/links, removed nodes, disabled/covered targets and credential
inputs fail explicitly. Scripts run in an isolated guest world; no arbitrary
JavaScript, uploads, rich-text editor automation, recording or interactive remote
browser stream is exposed. Read-only shared snapshots are not remote control.
Capture returns a bounded image, not a claim of verification.

Navigation can create the first guest only for the granted, visible thread.
Main waits up to ten seconds for matching DOM-ready registration; the initial
page is not loaded twice. Scripts, navigation and screenshots have watchdogs.
Text is limited to 20,000 characters, DOM walks to 5,000 nodes, elements to 200,
snapshot results to 96 KB and screenshot JPEGs to 1.5 MB / 1280px longest edge.
Password values are omitted. Console/load/crash diagnostics retain at most
80 entries per guest and clear on full navigation, never persist and do not
capture network headers or bodies.

The transport checks token, Host, Origin, method, path and body type; caps
bodies, clients and concurrent requests; rejects malformed/batched requests;
and never executes a tool notification. Overlapping operations on a token fail
without an unbounded queue. MCP calls also use desktop update admission.
Local `browser.tool` timings record only operation duration/failure, not URLs,
arguments or page contents. Runtime completion is distinct from UI verification.

### Turn evidence

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

Gateway ACP sessions run on the Gateway host. OpenClaw sandbox policy does not wrap them. The Gateway's non-interactive policy is:

- **Standard / Full access** → `plugins.entries.acpx.config.permissionMode=approve-all` (and `/acp permissions approve-all` on the session). Coding harnesses cannot write or fetch without this.
- **Supervised** → `deny-all`. Tools that would need a prompt are refused.
- If OpenClaw later forwards `session/request_permission` on the operator socket, Capsule maps it to Approvals. Until that exists, plugin config is the real switch. Old ACP workers keep the flags they started with — restart the Gateway after changing them.

## Do you need to install Claude Code in Capsule?

No. Capsule **picks them up**:

1. From `PATH` and common install locations on this Mac (`/opt/homebrew/bin`, `~/.local/bin`, a login shell, …).
2. From the OpenClaw Gateway host when acpx is enabled — even if the desktop process cannot see the binary. acpx may fetch adapters on first use.

If the UI says a CLI is already detected, the remaining step is **start/connect the Gateway**, not another install.

## What Capsule does not do

- Implement a CLI's model/tool loop or a Capsule-owned ACP server
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

## Delegation observations

Direct ACP tool updates retain a bounded projection of `rawInput.subagent_type`,
`description`, `model`, and `run_in_background`, plus numeric nonnegative
`rawOutput.usage.total_tokens` when present. Raw prompts/output are not retained
for this view. Partial updates fold by toolCallId; task completion describes the
tool, not a verified child lifetime. These are optional harness-specific fields,
not required ACP support. The UI labels missing data instead of inventing rows or
assigning parent tokens to children. No child-control protocol is implemented.

## Completion and retained output

Direct ACP retains bounded initialize metadata and config-option reports for
the owning live session. Config-only model catalogs also use the `model`
category. Reports disclose optional image, embedded-context, HTTP MCP and
session-loading capabilities; they do not enable unsupported route mutations.
Config notifications replace the complete option snapshot, including an empty
list. Removing a config model selector removes its derived model catalog. Only
a separately reported legacy `models` catalog can act as fallback; another
session's configuration never changes the current catalog.
Direct reports retain at most 16 select/boolean options and 32 choices per
selector, flattening either flat choices or one level of named choice groups.
Labels are bounded; oversized or unsafe identifiers are omitted, never clipped
into a different selectable value. Gateway metadata remains explicitly unreported when its status route
does not expose the handshake. No new agent runtime is introduced.

Permission requests retain a bounded text/diff/command projection plus locations.
The protocol's `allow_once` (or legacy one-time label) controls whether Approve
once is offered. Core validates this before recording a decision; permanent-only
options cannot masquerade as one-time approval. Approval details survive in the
database through migration 16 and are rendered in both approval entry points.

`usage_update` becomes a validated latest context snapshot; identical repeats
are ignored within the session. Prompt-result usage becomes a separate turn
report. Only updates for the owning ACP session are accepted. Core persists
`usage.context` and `usage.turn` events for the active run. Historical event pages
label these as reported values, not invoice totals or verification. They never
feed the transcript-derived Usage totals, avoiding double counting.

Direct prompt results and rejected sends emit the same terminal `lifecycle`
event the engine consumes for Gateway runs. Tests cover normal completion,
refusal, token-limit stops, transport failures and admitting the next turn.

Native stdout is decoded incrementally as UTF-8. An unterminated JSON-RPC frame
is limited to 4 MiB; an invalid or oversized frame rejects pending calls and
closes only the child owned by that session. Tool-title correlation retains at
most 1,000 IDs. These are transport bounds, not a replacement agent loop.

Core shares a `TextBudget` across reply buffers: 1 MiB per entry, 8 MiB total,
128 entries. Multiple completed messages must also fit the per-run limit.
Budget violations preserve an accepted prefix, fail the run, request route-
appropriate cancellation and suppress late replies until a new turn starts.
Only confirmed cancellation updates the live harness back to waiting.

Direct ACP uses optional v1 `messageId` values to separate consecutive assistant
messages, including when no tool ran between them. One exact ID of at most
1,024 characters is retained; absent, null or oversized IDs use the legacy
boundary rules. An identified message stays contiguous across tool activity.
For agents without IDs, new `tool_call` notifications separate prose segments.
Permission requests and transitions to reasoning also flush preceding prose.
The session emits a
`message-end` signal that the host maps to reply `done`; it does not finish the
run. Consecutive text chunks remain byte-for-byte contiguous. Background
`tool_call_update`, usage and config telemetry do not split text. Prompt exit
still flushes the last segment, including on rejection. Empty boundary flushes
are ignored, but a genuine one-character answer is retained. Gateway completed
message snapshots keep their existing boundaries. Both routes separate complete
messages with blank lines in run results and history reconstruction. Old merged
records are not heuristically rewritten.
