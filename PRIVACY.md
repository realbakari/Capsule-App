# Privacy

**Last updated: 2 October 2026 · Describes the accompanying desktop build**

Capsule runs on your computer and keeps your work there. This page describes exactly
what the app stores, what it sends, and when. It describes the software's real
behaviour, not an intention — every claim here is something you can check in the
source or with a network monitor.

## The short version

- Optional usage reports are off until you explicitly enable them. Capsule has
  no automatic crash reporting or hosted conversation service.
- Workspace history is stored locally. Prompts and selected context reach your
  chosen runtime and may leave the computer through a provider, remote Gateway or
  explicitly paired viewer.
- Browsing, catalog requests, Git operations, release checks and optional
  background integrations create network traffic described below.
- Coding CLIs use their own accounts and terms. Capsule passes them prompts and
  context; it does not control their network or file access.

## What is stored, and where

App-managed state lives in Electron's per-user application-data folder. On macOS
this is under `~/Library/Application Support/`; on Windows it is under `%APPDATA%`.
The app folder is normally `Capsule` for an installed build, or `@capsule/desktop`
for a development build. A custom profile uses the selected user-data directory.

| What | Where | Notes |
|---|---|---|
| Projects, conversations, messages, runs | `state/capsule.sqlite` | A plain SQLite file you can open, copy or delete. |
| Window size and position, appearance | `state/window-state.json` | |
| Skills directory cache | `state/skill-catalog.json` | Public listings, cached so the app does not refetch on every launch. |
| Gateway and skills.sh tokens | `state/secrets/secrets.json` | Encrypted when platform secure storage is available; see the fallback below. |
| Remembered shared-channel connection | `state/secrets/shared-relay.json` | Relay URL and identity key, encrypted with platform protected storage. No plaintext fallback. |
| Per-turn checkpoints | Inside your project's own `.git` | Hidden refs under `refs/capsule/checkpoints/`, excluded from Capsule's normal pushes. |
| Drafts, stashes, browser history and site data | Electron profile storage | Browser pages use an isolated partition; clearing their data does not clear drafts. |
| Pasted clipboard images | `attachments/` | Local files retained for message attachments. |
| Gateway device identity and tokens | `state/identity/` | Private files, separate from encrypted settings tokens. |

Removing that folder removes app-managed state, not project files, Git
checkpoints or the coding CLIs' own history. Uninstalling does not erase those
records. Quit before managing app files and back up anything you need. Token
encryption depends on platform safeStorage; the adapter can fall back to a
a plaintext file when encryption is unavailable. On Unix this fallback requests
mode 0600; Windows access follows the containing user profile's permissions.
Shared-channel keys do not use this fallback: remembering a connection requires
protected storage. Disconnect keeps remembered details; Forget connection
removes them. Saved channel details are not sent to paired viewers.

Workspace browsing is scoped to selected roots. Other features also read chosen
attachments and icons, global skill directories, CLI transcripts for Usage,
installed binaries and runtime configuration. Skills are discovered in Agent
Skills, Codex, Claude and OpenCode configuration folders; Capsule does not
recursively search the entire disk.

## What leaves your computer

Network activity depends on enabled features and the tools you run.

**1. Release checks and downloads.** Packaged builds check at startup and every
six hours, retrying failed checks after fifteen minutes. Manual checks are also
available. The updater reads GitHub release metadata; fallback discovery asks
`api.github.com` for this project's latest release with a `capsule-desktop` user
agent. Compatible updates download automatically unless you disable that setting.
Downloads fetch release artifacts and may follow GitHub/CDN redirects. GitHub's
logging applies, and your network path reveals the usual connection information.

**2. The skills directory, when you open it.** Browsing or installing a skill
queries GitHub's API and raw content hosts; an optional configured token enables
skills.sh. Search terms and requested skill identifiers can go to those services.
Attaching a skill includes its instructions in the runtime prompt.

**3. Your OpenClaw Gateway, when you use one.** By default this is
`ws://127.0.0.1:18789` — your own machine. If you point Capsule at a Gateway on
another host, your prompts and project paths travel there, and that host's
operator can see them. Capsule tells you which Gateway it is connected to in
Settings → Gateway.

**4. Git and GitHub, through your tools.** Clone, fetch, push and pull-request
operations run `git` and `gh` using existing credentials. Enabled review watching
can poll in the background. Repository contents and review text travel according
to the operation. Capsule does not store a separate GitHub account token.

**5. Remote access, only if you turn it on.** Capsule can serve its workspace
to a browser you pair. It is off by default. When on, it
listens on loopback or your local network, requires a one-time pairing token
that expires in five minutes and stores only a hash of that token. Read-only is
the default. A separate desktop-issued conversation-control link permits new
supervised conversations, text prompts, stopping runs, and once-only approvals.
Existing conversations keep their permissions; their agents may edit files and
run commands. Control requires loopback or an explicitly configured HTTPS proxy
on the same host. It does not grant desktop administration or raw terminal
access. Turning remote access off stops the server and revokes devices.

Paired sessions expire twelve hours after pairing. Revoke immediately closes
live connections. Network mode uses plain HTTP/WebSocket, not end-to-end
encryption; use only a trusted network or a tunnel you manage.

**6. Browser pages and previews.** Embedded pages connect to their sites and
subresources and store cookies or site data in Capsule's browser partition.
Search queries use the browser's search URL. Local-server discovery probes
listening HTTP(S) endpoints. Browser screenshots or selected DOM context
attached to a prompt become available to its runtime. External links use your
system browser and its privacy settings when explicitly opened there.

If you grant a compatible direct agent browser control, its browser-tool calls
can read bounded page text, links, viewport screenshots and recent console/load
diagnostics, and interact with page controls. Those results reach the agent and
may be sent to its provider, including private content visible in a signed-in
page. Access uses a per-process loopback credential and ends when revoked, when
you leave the visible panel or switch threads, or when the owning process exits.
Visible browser cookies are shared across threads. Recent page diagnostics are bounded
in memory and clear on navigation; they are not a telemetry feed. Capsule denies
embedded-page device permissions and downloads. These restrictions do not
restrict the coding CLI's own tools or network access.

Background pages are started explicitly, use separate temporary browser profiles,
and close after 30 minutes, on explicit close or when Capsule quits. Their
separate agent-control grant survives panel switches but is revoked on process
exit. A separate sharing switch exposes a page's URL and bounded screenshots to
paired viewers, including sensitive content on the page. Sharing is off by default;
revocation prevents subsequent reads but cannot retract already received pixels.
The viewer remains read-only and follows the pairing/network security described
above. These pages do not import your system browser's profile.

Native direct attachments send explicitly attached image or embedded-resource
bytes to the coding agent when its negotiated capabilities support them. The
agent may send that content to its provider. Capsule stores attachment metadata
with the message, not a second copy of encoded prompt bytes. Files created by
clipboard paste remain local files in the app profile.

**7. Agents, commands and integrations.** Coding CLIs, saved actions and shells
can read files and make their own network requests with your permissions.
Gateway plugins and connected services have their own policies. Capsule's
local-command and web preferences are not an operating-system network sandbox.

**8. Shared channels, when you connect.** The installed relay CLI authenticates
to the relay you choose. Channel messages, replies, mentions and membership
changes go to that relay and are available according to its access rules.
Ordinary channel history remains on the relay, not in Capsule's local conversation database.
A remembered connection reconnects when you open Channels after restarting.
Incoming messages do not start local agents or grant file access by default.
If you enable a channel's Capsule harness and automatic replies, your own new
messages beginning with `@capsule` are saved locally and sent to the selected
project harness and its provider. Capsule automatically publishes the resulting
answer to the same channel thread as your relay identity. Answers can contain
private project information; enable this only in channels where you intend to
share that information. Other members cannot trigger local work. Bindings,
pending prompts, run links and delivery state are saved in the local database.
Pausing stops new work and automatic replies, but does not stop an active run.
Choosing **Run with Capsule** copies the selected message into a saved local
project conversation and sends it to the chosen harness and its provider under
the normal project permissions. Other members cannot trigger this manual action. Generated
results remain local until you explicitly choose **Share reply to thread**;
review them for private project information before publishing under your relay
identity. Disconnecting does not delete that saved local conversation.

Visible profile pictures may be fetched from the connected relay or a public
HTTPS host named in a member's profile. Those hosts receive normal network
connection information, including your IP address. Capsule sends no relay key,
cookies or referrer with image requests. Profile images are cached in memory,
not saved to disk, and missing or unsupported images use initials.

## Companion voice

On macOS, pressing **Talk** starts one short microphone session after system
permission is granted. Capture lasts at most ten seconds. **Stop**, closing the
tray, hiding the companion, or quitting cancels capture. The microphone is not
active between commands.

The companion requires on-device English speech recognition and does not fall
back to a network speech service. Capsule holds the transcript in memory only
long enough to match a fixed companion command. It does not save audio or
transcripts, send them to an agent, or include them in diagnostic logs.

**Read status** uses the system voice to speak aggregate workspace counts. It
does not read thread titles or message contents. Automatic spoken status is off
by default and can be enabled for the open tray. Paired viewers and embedded
browser pages cannot access companion voice.

## What Capsule does *not* do

- It does not send your prompts, code, file contents or conversation history to
  its authors. There is no Capsule server.
- It does not include session recording, automatic click tracking, crash
  reporting or A/B testing.
- It does not sell workspace data. The feature-related transfers above are not
  a promise that no information leaves the device.

## Optional usage reports

Settings → General → Help improve Capsule controls reports to the maintainers'
US analytics project at `us.i.posthog.com`. New and existing profiles default
off. Opting in sends a random installation ID, app version, platform, analytics
session starts, daily installation activity, harness category, runtime route,
run outcomes/duration, and aggregate Capsule CPU/memory samples at most once per
ten minutes. Unknown values are not guessed. No prompts, responses, code, titles,
paths, credentials, raw logs or errors, or token/cost data are included. The
receiving service sees the network address; geographic lookup and person-profile
processing are disabled. An installation ID is not a user account.

The ID is saved in the profile's `state/analytics-id` file only after consent.
Queued events stay in bounded memory, are sent over HTTPS, and are discarded on
delivery failure or shutdown. Turning reports off discards the queue, aborts
pending delivery and removes the local ID; it cannot recall already received
events. Enabling later creates a new ID. Previously delivered reports are not
automatically deleted. Browser clients cannot change host consent.

## Your AI provider is a separate relationship

This is the part worth understanding clearly. Capsule drives coding CLIs you
have already installed and signed into — Claude Code, Codex, Grok Build, Gemini
and others. When you send a message, that CLI sends your prompt and whatever
file contents it decides to read to the company that made it.

Capsule is not a party to that. It holds no API keys for those services, cannot
see your account, and cannot change what they collect or retain. What happens to
your prompt after it leaves the CLI is governed by that company's privacy policy
and your agreement with them. Read theirs.

## Children

Capsule is a developer tool and is not directed at children under 13.

## Changes

Material changes to this page will be noted in the release that carries them,
and the date above will change. The history of this file is public in the
repository.

## Contact

Privacy questions: open an issue at
<https://github.com/realbakari/Capsule-App/issues>, or use the contact address
published in the repository's README.

---

*This document describes software behaviour and is not legal advice. If you
deploy Capsule inside an organisation, have your own counsel review it against
the obligations that apply to you.*
