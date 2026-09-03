<div align="center">

<img src="assets/logo.png" alt="Capsule Logo" width="120" />

# Capsule

**A local-first macOS workspace for AI coding agents & harnesses.**

[![GitHub Release](https://img.shields.io/github/v/release/realbakari/Capsule-App?style=flat-square&color=black)](https://github.com/realbakari/Capsule-App/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/realbakari/Capsule-App/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/realbakari/Capsule-App/actions)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20(arm64)-black?style=flat-square&logo=apple)](https://github.com/realbakari/Capsule-App/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[Download Latest .dmg](https://github.com/realbakari/Capsule-App/releases/latest) · [Architecture](ARCHITECTURE.md) · [Desktop Spec](docs/internals/desktop.md) · [Harnesses](docs/internals/harness.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is Capsule?

Capsule is a desktop workspace for the coding agents you already run. Claude
Code, Codex, Grok Build and other ACP harnesses do the work; Capsule gives them
a window — projects, conversations, diffs, approvals and a record of what each
turn changed, on your own machine.

It installs nothing on your behalf and holds no API keys. If a CLI is on your
Mac and signed in, Capsule can drive it.

### What it does

**Runs the agents you have.** Start, steer, cancel and close a harness session,
and switch a conversation from one agent to another without losing the thread.

**Shows the work, not just the answer.** Every turn keeps its commands, its
tool calls, the files it touched and the lines it moved — and a checkpoint, so
you can see what a single turn changed and put it back.

**Reviews changes where you are.** Diffs, changed files, and pull requests read
in the app instead of a browser tab.

**Keeps your work on your Mac.** A local SQLite database, tokens encrypted in
the Keychain, no analytics and no telemetry. Read [PRIVACY.md](PRIVACY.md) —
it lists everything that leaves the machine, which is five things.

**Works without a Gateway.** Direct mode spawns an ACP-capable CLI itself, so
an install with nothing else running still gets a working turn.

**Ships signed.** Official builds are Developer ID signed and notarized by
Apple, so Gatekeeper opens them without argument. Verify any download with
`spctl --assess --type execute -vv /Applications/Capsule.app`.

---

## Installation

Download the latest Apple Silicon DMG from GitHub Releases:

**[Download the latest release](https://github.com/realbakari/Capsule-App/releases/latest)**

1. Open `Capsule-0.1.0-arm64.dmg`.
2. Drag **Capsule** into your **Applications** folder.
3. Launch Capsule!

---

## Developing Capsule

Capsule is built as a pnpm monorepo using Electron, Vite, React, and TypeScript.

### Prerequisites
- macOS (Apple Silicon arm64 recommended)
- **Node.js**: `22+`
- **pnpm**: `10+`

### Setup & Run Locally

```bash
# Clone the repository
git clone https://github.com/realbakari/Capsule-App.git
cd Capsule-App

# Install dependencies (automatically sets up Electron & native modules)
pnpm install

# Start the desktop app in development mode
pnpm dev
```

### Quality Gates & Testing

```bash
pnpm test         # Run Vitest test suite under Electron
pnpm lint         # Run ESLint across packages
pnpm typecheck    # Run TypeScript checks
pnpm build        # Build all packages and desktop renderer
pnpm package:mac  # Package signed and notarized macOS release bundle
```

If `pnpm dev` warns about Electron or native modules:
```bash
node scripts/ensure-electron.mjs  # Downloads Electron binary if skipped
node scripts/ensure-native.mjs    # Compiles SQLite for Electron
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Capsule UI                         │
│   (Collapsible Sidebar · Composer · Run Inspector)       │
└────────────────────────────┬────────────────────────────┘
                             │ IPC (Strict Allowlist)
┌────────────────────────────▼────────────────────────────┐
│                    Capsule Core                         │
│  (Projects · Sessions · Run Events · Keychain Storage)  │
└──────────────┬───────────────────────────┬──────────────┘
               │                           │
┌──────────────▼────────────┐ ┌────────────▼──────────────┐
│     OpenClaw Adapter      │ │        ACP Harness        │
│ (Protocol 4 Gateway RPC)  │ │  (Claude Code / Codex)    │
└───────────────────────────┘ └───────────────────────────┘
```

Capsule enforces clean architectural separation:
- Adapters own all I/O.
- The UI renderer only imports `@capsule/shared` and `@capsule/ui`.
- SQLite, filesystem operations, and Keychain are isolated in the Electron main process via `@capsule/core`.

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and [AGENTS.md](AGENTS.md) if an
agent is doing the work.

1. Fork the repo & create your feature branch: `git checkout -b feat/my-feature`
2. Ensure tests and lint pass: `pnpm test && pnpm lint && pnpm typecheck`
3. Commit your changes: `git commit -m "feat: my new feature"`
4. Push the branch and open a pull request.

---

## Licence and policies

MIT © Bakari Mustafa — see [LICENSE](LICENSE).

- [Privacy](PRIVACY.md) — what is stored, and the five things that leave your Mac.
- [Security](SECURITY.md) — reporting a vulnerability, and what Capsule does and does not defend against.
- [Terms of use](TERMS.md) — how the software is offered.
