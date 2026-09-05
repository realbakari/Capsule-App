# Security

**Applies to Capsule for macOS · Last updated 5 September 2026**

## Reporting a vulnerability

Report privately, not in a public issue.

Use GitHub's private advisory form:
<https://github.com/realbakari/Capsule-App/security/advisories/new>. It reaches
the maintainers and nobody else.

Please include what you were running (Settings → About has the version), what
you did, what happened, and — if you have one — the smallest reproduction.

What to expect: an acknowledgement within seven days, and an assessment within
thirty. If a report is valid you will be credited in the release notes unless
you would rather not be. There is no bounty programme.

Please give a fix a reasonable window before disclosing publicly. If you hear
nothing in thirty days, treat that as agreement to disclose.

## Supported versions

| Version | Supported |
|---|---|
| Latest published release | Yes |
| Older releases | Upgrade for fixes |

Capsule is pre-1.0 and ships from one branch. Fixes land in the next release
rather than being backported.

## What Capsule protects, and how

**Secrets.** The OpenClaw operator token and the skills.sh token are encrypted
with a key held in the macOS Keychain, through Electron's `safeStorage`, and
written to a file readable only by your user. Before 0.1.1 they were stored in
plain text; upgrading re-encrypts them on the next write when encryption is
available. The adapter falls back to a mode-0600 plaintext file if safeStorage
is unavailable. Device identity credentials are also mode-0600 files.

**Privileged capabilities are explicit.** The interface can start project
commands and interactive shells through named IPC channels. Main enforces local
command policy; read-only viewers cannot invoke them. Renderer JavaScript has
no Node integration and no arbitrary main-process RPC bridge.

**Remote access is read-only and off by default.** When enabled it binds to
loopback unless you choose your local network, requires a one-time pairing token
that expires in five minutes, stores only a hash of that token, compares it in
constant time, and refuses every channel classified as a write. A channel is
classified as a write unless it is explicitly listed as a read, so a new one is
refused by default rather than exposed by accident.
Revocation and absolute twelve-hour expiry disconnect existing sockets, not
just future logins. Requests, events and delayed replies recheck access. Network
mode is plain HTTP/WebSocket; pairing does not encrypt the transport.

**Filesystem access is scoped.** File operations refuse paths outside the
project folders you added. Attachment, skill discovery, transcript and
configuration readers have separate scopes; see [Privacy](PRIVACY.md).

**Verify release artifacts.** Packaging supports Developer ID signing and
notarization with configured credentials and an unsigned fallback otherwise.
Do not infer a signature from a release label. Check the download:

```bash
codesign -dv --verbose=2 /Applications/Capsule.app
spctl --assess --type execute -vv /Applications/Capsule.app
```

The second reports `source=Notarized Developer ID` for a notarized build. If it
does not, inspect the release's provenance and notes rather than bypassing
Gatekeeper on the strength of this document.

## What Capsule does not protect against, by design

Be clear-eyed about these. They are consequences of what the app is for, not
oversights.

**The agent runs with your permissions.** Capsule drives coding CLIs that read
and write files and run commands on your machine, as you. Permission modes and
the approval prompt exist to put you in the loop, but an agent you approve can
do anything you can. Capsule is not a sandbox, and it does not claim to be one.

**Prompt injection is real.** An agent that reads a file, a web page or a
dependency can be instructed by its contents. Nothing here prevents that. Treat
a repository you did not write as untrusted input, and read what an agent
proposes before approving it.

**Anyone on your network can try to pair.** With remote access on and set to
network reach, the pairing endpoint is reachable by anything that can route to
your Mac. The token is what protects it. Do not enable it on a network you do
not trust, and turn it off when you are done.

**Your Gateway sees everything.** A Gateway on another host receives your
prompts and project paths. Trust it as much as you trust that machine.

**Local files are not encrypted at rest.** The database holds your conversations
in plain SQLite. It is protected by your account and FileVault, and by nothing
else. If your disk is not encrypted, neither is your history.

## Out of scope

Reports about these will be closed politely:

- An agent doing something destructive after you approved it.
- Vulnerabilities in Claude Code, Codex, Grok, Gemini, OpenClaw or the `gh` CLI.
  Report those to their maintainers.
- Anything requiring an attacker who already has your unlocked Mac.
- Missing hardening that does not lead to a concrete attack.

---

*This describes the software's real behaviour and its limits. It is not a
warranty and not legal advice.*
