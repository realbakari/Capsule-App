# Security

**Applies to Capsule for macOS · Last updated 3 September 2026**

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
| 0.1.x | Yes |
| Anything older | No |

Capsule is pre-1.0 and ships from one branch. Fixes land in the next release
rather than being backported.

## What Capsule protects, and how

**Secrets.** The OpenClaw operator token and the skills.sh token are encrypted
with a key held in the macOS Keychain, through Electron's `safeStorage`, and
written to a file readable only by your user. Before 0.1.1 they were stored in
plain text; upgrading re-encrypts them on the next write.

**The renderer has no shell.** Every capability the interface has is a named IPC
channel with a handler in the main process. There is no generic "run this"
bridge, and adding a capability means adding a channel deliberately.

**Remote access is read-only and off by default.** When enabled it binds to
loopback unless you choose your local network, requires a one-time pairing token
that expires in five minutes, stores only a hash of that token, compares it in
constant time, and refuses every channel classified as a write. A channel is
classified as a write unless it is explicitly listed as a read, so a new one is
refused by default rather than exposed by accident.

**Filesystem access is scoped.** File operations refuse paths outside the
project folders you added.

**Builds are signed.** Official releases are signed with a Developer ID
certificate and notarized by Apple. You can check any download before opening
it:

```bash
codesign -dv --verbose=2 /Applications/Capsule.app
spctl --assess --type execute -vv /Applications/Capsule.app
```

The second should say `source=Notarized Developer ID`. A build that does not is
not one of ours.

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
