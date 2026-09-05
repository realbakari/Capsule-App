# Privacy

**Last updated: 5 September 2026 · Describes the current Capsule for macOS release**

Capsule runs on your Mac and keeps your work there. This page describes exactly
what the app stores, what it sends, and when. It describes the software's real
behaviour, not an intention — every claim here is something you can check in the
source or with a network monitor.

## The short version

- Capsule has no usage analytics, telemetry or automatic crash reporting to its
  authors. It does not operate a hosted conversation service.
- Workspace history is stored locally. Prompts and selected context reach your
  chosen runtime and may leave the Mac through a provider, remote Gateway or
  explicitly paired viewer.
- Browsing, catalog requests, Git operations, release checks and optional
  background integrations create network traffic described below.
- Coding CLIs use their own accounts and terms. Capsule passes them prompts and
  context; it does not control their network or file access.

## What is stored, and where

App-managed state lives primarily in your macOS Application Support folder, under
`~/Library/Application Support/@capsule/desktop/`.

| What | Where | Notes |
|---|---|---|
| Projects, conversations, messages, runs | `state/capsule.sqlite` | A plain SQLite file you can open, copy or delete. |
| Window size and position, appearance | `state/window-state.json` | |
| Skills directory cache | `state/skill-catalog.json` | Public listings, cached so the app does not refetch on every launch. |
| Gateway and skills.sh tokens | `state/secrets/secrets.json` | Encrypted when platform secure storage is available; see the fallback below. |
| Per-turn checkpoints | Inside your project's own `.git` | Hidden refs under `refs/capsule/checkpoints/`, excluded from Capsule's normal pushes. |
| Drafts, stashes, browser history and site data | Electron profile storage | Browser pages use an isolated partition; clearing their data does not clear drafts. |
| Pasted clipboard images | `attachments/` | Local files retained for message attachments. |
| Gateway device identity and tokens | `state/identity/` | Private files, separate from encrypted settings tokens. |

Removing that folder removes app-managed state, not project files, Git
checkpoints or the coding CLIs' own history. Uninstalling does not erase those
records. Quit before managing app files and back up anything you need. Token
encryption depends on platform safeStorage; the adapter can fall back to a
mode-0600 plaintext file when encryption is unavailable.

Workspace browsing is scoped to selected roots. Other features also read chosen
attachments and icons, global skill directories, CLI transcripts for Usage,
installed binaries and runtime configuration. Skills are discovered in Agent
Skills, Codex, Claude and OpenCode configuration folders; Capsule does not
recursively search the entire disk.

## What leaves your Mac

Network activity depends on enabled features and the tools you run.

**1. An update check, once a day.** A request to
`api.github.com` asking for this project's latest release. It carries no
identifier beyond a `capsule-desktop` user agent and whatever your network path
reveals. The updater also reads release metadata. Requested downloads fetch
release artifacts and may follow GitHub/CDN redirects. GitHub's logging applies.

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

**5. Remote access, only if you turn it on.** Capsule can serve a read-only view
of itself to another device on your network. It is off by default. When on, it
listens on loopback or your local network, requires a one-time pairing token
that expires in five minutes, stores only a hash of that token, and refuses
every write. Turning it off stops the server.

Paired sessions expire twelve hours after pairing. Revoke immediately closes
live connections. Network mode uses plain HTTP/WebSocket, not end-to-end
encryption; use only a trusted network or a tunnel you manage.

**6. Browser pages and previews.** Embedded pages connect to their sites and
subresources and store cookies or site data in Capsule's browser partition.
Search queries use the browser's search URL. Local-server discovery probes
listening HTTP(S) endpoints. Browser screenshots or selected DOM context
attached to a prompt become available to its runtime. External links use your
system browser and its privacy settings when explicitly opened there.

**7. Agents, commands and integrations.** Coding CLIs, saved actions and shells
can read files and make their own network requests with your permissions.
Gateway plugins and connected services have their own policies. Capsule's
local-command and web preferences are not an operating-system network sandbox.

## What Capsule does *not* do

- It does not send your prompts, code, file contents or conversation history to
  its authors. There is no Capsule server.
- It does not include analytics, telemetry, session recording, crash reporting
  or A/B testing. There is no such code in the repository.
- It does not sell workspace data. The feature-related transfers above are not
  a promise that no information leaves the device.

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
