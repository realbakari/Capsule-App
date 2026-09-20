# Providers and credentials

If saving settings fails, Capsule keeps the previous settings and attempts to
restore any changed saved credentials. Check storage access before retrying. If
Capsule reports that credentials could not be restored, re-enter them in
Settings; do not assume the failed save signed you out successfully.

## Agent approvals and reported usage

Direct-agent approvals include the reported target and an expandable proposed
operation. Command and diff excerpts are bounded and marked when shortened;
missing targets are not guessed from the working folder. **Approve once** is
unavailable if the agent only offers permanent permission. **Deny** remains
available. The same details and restriction appear in the conversation and the
Approvals view. Capsule does not silently grant permanent or session permission.
Stopping or closing an agent cancels its unanswered approvals; it does not tell
the agent you chose **Deny**. Unanswered approvals also clear when the turn ends
or exceeds the output limit. A cancelled request cannot be approved later.
Approvals clear as soon as you request Stop or Close, even if the agent takes
time to confirm. A cancellation timeout does not mean its work has stopped.

Some direct agents report context occupancy and per-turn token counts. The
context meter uses the latest occupancy snapshot, not a sum of repeated reports.
Expand **Agent-reported usage** in the run log for reported turn tokens and any
reported cumulative session cost. These are separate measures and are not added
to the Usage page's transcript estimates. Missing values remain **not reported**.
Gateway sessions continue to use the information that route actually carries.

### Subscription observations

**Usage → Subscription usage** shows the latest allowance reported by a running
native Muse session: its plan, current window, weekly window and reset times.
This is separate from transcript tokens and cost. Missing data means **Not
reported**, not unused allowance. Old observations, clock differences and reset
times that have passed are labelled; passing a reset time does not invent a new
balance. Values above 100% remain visible.

When several conversations report usage, choose the source conversation. Their
accounts may differ, so Capsule never adds their allowances together. Closing
the source removes its report. **Refresh report** rereads the cached observation;
it does not start an agent or contact a provider. Failed reads preserve the last
observation with a warning and a retry button. Paired read-only devices can view
these reports too.

## Installed agents

Capsule drives coding CLIs that are already installed and signed in on the
machine running the selected route. New installations default to **Direct · local
agents**, which needs no Gateway. Gateway-backed agents and messaging channels
remain optional. Saved route preferences and existing conversations are not
migrated: change the default under **Settings → Agents → Runtime** for new
conversations. In Direct mode startup does not attempt a Gateway connection;
use **Settings → Gateway** to connect explicitly when needed.
Capsule does not install CLIs, does not sign
you in, and never resells tokens.

| Provider | Executable |
|----------|-----------|
| Claude Code | `claude` |
| Codex | `codex` |
| Grok Build | `grok` |
| Muse Code | `muse` |
| Cursor | `cursor-agent` |
| OpenCode | `opencode` |
| Gemini Flash | `gemini` |
| Gemini CLI | `gemini` |
| GitHub Copilot | `copilot` |

Sign in with each tool's own flow — `claude`, `codex login`, `grok login`, and so on.

### Local Claude Code and Codex

Direct mode uses the installed `claude-agent-acp` or `codex-acp` adapter. Install
the matching adapter yourself before starting the agent:

```sh
npm install -g @agentclientprotocol/claude-agent-acp
npm install -g @agentclientprotocol/codex-acp
```

Only install the adapter you intend to use. Complete the provider's own sign-in,
then run **Check this agent** in Harnesses. Capsule does not download adapters
automatically or register these local commands in Gateway configuration. A
missing adapter is reported before a conversation starts; a provider CLI alone
does not prove that its ACP adapter is installed. Existing Gateway conversations
stay on that route; start a new conversation to use Direct mode.

Protocol fixtures cover local startup, replies, configuration and resume. They
do not certify every installed adapter version or signed-in provider account.

If a CLI reports an unsupported sign-in or account, check that tool's setup on
the machine running it. Capsule reports the error; changing its UI settings
cannot repair provider access. Gemini Flash and Gemini CLI use the same binary;
the first pins the Flash model, the second takes the CLI default.

## Muse Code

Install [Muse Code](https://dev.meta.ai/docs/muse-code) and complete its sign-in
in a terminal. Your CLI build must support native session connections through
`muse serve`; Capsule cannot unlock a build or account that lacks this support.
Choose **Muse Code** from the composer or **Harnesses**, and select a project
folder. Muse runs locally even when your default route is Gateway. Existing
threads keep their original agent and route.

Text, supported images, streamed replies, tool activity, one-time approvals,
Stop, reported model choices and reasoning defaults are connected. Model choices appear after the
session starts and come from that session, not a fixed global list. Capsule can
resume a saved idle session when the installed CLI supports durable sessions
and confirms the same folder and identity. A folder alias resolving to the
same location is accepted; another folder is not.

The reasoning default is in **Agent settings**, in both the composer and
Harnesses. Its eight levels range from **None** through **Ultra** and apply to
future turns; they do not control whether reasoning text is visible. An unknown
current value stays unknown until the session reports it or accepts your change.
On resume Capsule makes one bounded attempt to recover the saved default;
missing history does not block conversation. A rejected change preserves the
previous value.

The setup check finds the executable; it does not verify Muse sign-in or SDK
access. Connection errors explain those requirements. Sign-in stays with the
CLI, and Capsule never reads its credentials.

This integration has fixture-based protocol and workspace tests, not validation
against every signed-in account. Interactive questionnaire forms, live steering,
permission setting changes, and Capsule browser-tool injection are
not supported for Muse yet. Manual browsing remains available. Unsupported
content or an unavailable activity stream produces an error, not a successful
empty reply.

## Choose and check a harness

Open **Harnesses** from the agent picker or type `/runtimes`. The catalog puts
installed agents first. Select one to see its readiness, run **Check this
agent**, make it the default for the current project, or start a persistent or
one-turn session.

A check and outlined row mark the selected harness. The readiness text and
project-default label describe its setup separately; hovering another row does
not select it or change the project default.

The project folder and session lifetime are set once in the bar above the
catalog. An open session appears in the selected agent's detail panel, where
you can refresh status, cancel the current turn, or close it. Gateway sessions
can request supported model, permission, timeout and mode changes. Direct
sessions expose **Agent settings** inside Capabilities in both the composer and
Harnesses. Selectors and switches use the exact IDs and choices reported by the
agent, and wait for its acknowledgement. Model choices require a reported model
selector. Capsule's permission profiles are not automatically mapped to the
agent's own policy controls; read the setting description before changing it.
Direct Steer remains unavailable. Unsupported changes show an error. The live working
folder cannot change: close the agent and start a thread in the desired folder.

After a restart or an ended process, sending another message restores a direct
session through the agent's advertised resume or load operation. Capsule keeps
the native session ID, harness and working folder together. It does not quietly
start a fresh agent conversation if restoration fails. Keep the existing
transcript and start a new conversation if the saved session has expired or the
agent cannot restore it. Threads created before native session identity was
recorded retain their Capsule history but cannot restore that missing identity.

When the live agent publishes its available models through ACP, **Model** is a
dropdown containing those exact choices. If the agent does not publish a list,
Capsule shows a model-id field instead. Model ids belong to the selected agent;
Capsule does not reuse one provider's names for another.

Capsule disables **Start a session** when the project has no folder or the route
is not ready. Gateway-only agents need the Gateway and acpx; direct mode needs
a detected native ACP CLI but no Gateway. Both check login when a probe exists.
Run the check shown in the detail panel to see which prerequisite is missing.

Direct connections check protocol compatibility before opening a conversation.
If the agent selects an unsupported version, Capsule reports the mismatch and
closes that connection. Use a compatible agent version or update Capsule.

Browser tools are offered only when the direct agent explicitly reports support
for HTTP MCP. Enable **Allow agent control** in the current thread's Browser
panel to let that agent inspect and interact with its page; you can revoke it
there at any time. Switching threads or leaving the panel ends access.
Otherwise the conversation can continue without those tools, and
**Capabilities** explains the limitation after status is loaded. You can still
browse manually. Refreshing status replaces reported model choices, including
choices the agent has removed; Capsule does not keep an obsolete model list.
Agents may publish models as a flat list or in groups; either form can supply
the reported choices. Large lists are limited to 32 choices per selector.

When a direct agent identifies separate messages, progress updates and the
answer remain separate even if no tool ran between them. Token chunks within
one message stay together. Older agents use tool and reasoning transitions to
separate messages. Previously saved merged replies are not automatically split.

An agent describing an error does not by itself mean the turn has failed.
Capsule waits for the runtime's outcome and keeps subsequent progress and the
final answer. After an interrupted app session, unanswered approvals are
cancelled, not denied; the thread can accept a new message without an orphaned
permission request blocking it.

## If you want to use an API key instead of a subscription

Capsule has no provider-key entry field. Keys belong to the coding CLI's own
configuration or to the environment of the process that launches it.

Set it where the Gateway starts, or in the environment used to launch Capsule
for a direct agent. Codex reads `CODEX_API_KEY` or
`OPENAI_API_KEY`; Claude Code reads `ANTHROPIC_API_KEY`; Grok Build reads
`XAI_API_KEY`:

```bash
OPENAI_API_KEY=… ANTHROPIC_API_KEY=… XAI_API_KEY=… openclaw gateway run
```

A Gateway installed as a background service does not inherit your shell, so
exporting a variable in a terminal will not reach it.
