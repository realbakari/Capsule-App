# Privacy

**Last updated: 3 September 2026 · Applies to Capsule for macOS 0.1.0 and later**

Capsule runs on your Mac and keeps your work there. This page describes exactly
what the app stores, what it sends, and when. It describes the software's real
behaviour, not an intention — every claim here is something you can check in the
source or with a network monitor.

## The short version

- Capsule has no analytics, no telemetry, and no crash reporting. Nothing
  reports how you use it, and there is no server that receives anything.
- Your conversations, prompts, files and projects stay on your Mac.
- Capsule makes network requests only for things you ask it to do, plus one
  update check a day. Each is listed below.
- Your prompts do reach the AI provider you chose — but Capsule does not send
  them. The coding CLI you installed does, under its own account and terms.

## What is stored, and where

Everything lives in your macOS Application Support folder, under
`~/Library/Application Support/@capsule/desktop/`.

| What | Where | Notes |
|---|---|---|
| Projects, conversations, messages, runs | `state/capsule.sqlite` | A plain SQLite file you can open, copy or delete. |
| Window size and position, appearance | `state/window-state.json` | |
| Skills directory cache | `state/skill-catalog.json` | Public listings, cached so the app does not refetch on every launch. |
| Gateway and skills.sh tokens | `state/secrets/secrets.json` | Encrypted with a key held in your macOS Keychain. |
| Per-turn checkpoints | Inside your project's own `.git` | Hidden refs under `refs/capsule/checkpoints/`. Never pushed. |

Deleting that folder removes everything Capsule knows. Uninstalling the app does
not delete it, so remove it yourself if that is what you want.

Capsule reads files inside project folders you choose, and only there. It does
not scan your disk.

## What leaves your Mac

Five things, and nothing else.

**1. An update check, once a day.** A request to
`api.github.com` asking for this project's latest release. It carries no
identifier beyond a `capsule-desktop` user agent and whatever your network path
reveals. GitHub's own logging applies. There is no way to switch this off in
0.1.0; if that matters to you, block the host.

**2. The skills directory, when you open it.** Browsing or installing a skill
queries `skills.sh` and GitHub's public API. Your search terms go to those
services. If you never open Skills, nothing is sent.

**3. Your OpenClaw Gateway, when you use one.** By default this is
`ws://127.0.0.1:18789` — your own machine. If you point Capsule at a Gateway on
another host, your prompts and project paths travel there, and that host's
operator can see them. Capsule tells you which Gateway it is connected to in
Settings → Gateway.

**4. Git and GitHub, through your own tools.** Pushing, opening a pull request
and reading review comments run `git` and the `gh` CLI on your machine with the
credentials you already gave them. Capsule does not hold GitHub credentials.

**5. Remote access, only if you turn it on.** Capsule can serve a read-only view
of itself to another device on your network. It is off by default. When on, it
listens on loopback or your local network, requires a one-time pairing token
that expires in five minutes, stores only a hash of that token, and refuses
every write. Turning it off stops the server.

## What Capsule does *not* do

- It does not send your prompts, code, file contents or conversation history to
  its authors. There is no Capsule server.
- It does not include analytics, telemetry, session recording, crash reporting
  or A/B testing. There is no such code in the repository.
- It does not read files outside the project folders you add.
- It does not sell, share or transfer anything, because it collects nothing.

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
