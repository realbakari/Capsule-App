<div align="center">

<img src="assets/logo.png" alt="Capsule Logo" width="120" />

# Capsule

**A local-first macOS workspace for AI coding agents & harnesses.**

[![GitHub Release](https://img.shields.io/github/v/release/realbakari/Capsule-App?style=flat-square&color=black)](https://github.com/realbakari/Capsule-App/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/realbakari/Capsule-App/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/realbakari/Capsule-App/actions)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20(arm64)-black?style=flat-square&logo=apple)](https://github.com/realbakari/Capsule-App/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[Download Latest .dmg](https://github.com/realbakari/Capsule-App/releases/latest) · [First conversation](docs/user/getting-started.md) · [User guide](docs/README.md) · [Architecture](ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is Capsule?

Capsule is a desktop workspace for the coding agents you already run. Claude
Code, Codex, Grok Build and other ACP harnesses do the work; Capsule gives them
a window — projects, conversations, diffs, approvals and a record of what each
turn changed, on your own machine.

It does not install coding CLIs or hold their provider API keys. Install and
sign in to a supported CLI, then choose its available runtime route. Some
harnesses require an OpenClaw Gateway and its ACP adapter.

### What it does

**Runs the agents you have.** Start, cancel and close a harness session,
and switch a conversation from one agent to another without losing the thread.
Steer and live setting changes depend on the runtime route; unsupported changes
report a limitation instead of claiming success.

**Keeps a record of the work.** Turns retain the activity the agent reports.
Git-backed turns capture checkpoints for saved diffs and restoration. A completed
reply is not proof that tests passed: verification receipts require a saved
local check and matching revision evidence.

**Reviews changes where you are.** Diffs, changed files, and pull requests read
in the app instead of a browser tab.

**Keeps your work on your Mac.** A local SQLite database, tokens encrypted in
the Keychain when available, no analytics and no telemetry. Read
[PRIVACY.md](PRIVACY.md) for browser, provider, catalog and remote-access data flows.

**Works without a Gateway.** Direct mode spawns an ACP-capable CLI itself, so
an install with nothing else running still gets a working turn.

**Verifiable downloads.** Packaging supports Developer ID signing and Apple
notarization, but can also produce unsigned builds when credentials are absent.
Check release notes and verify the downloaded app with
`spctl --assess --type execute -vv /Applications/Capsule.app`.

---

## Installation

Download the latest Apple Silicon DMG from GitHub Releases:

**[Download the latest release](https://github.com/realbakari/Capsule-App/releases/latest)**

1. Open the downloaded `.dmg`.
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
pnpm package:mac  # Package macOS; signing/notarization require credentials
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
│     OpenClaw Adapter      │ │      Direct ACP host       │
│ (Protocol 4 Gateway RPC)  │ │  (native ACP CLIs)         │
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

- [Privacy](PRIVACY.md) — local storage and network activity.
- [Security](SECURITY.md) — reporting a vulnerability, and what Capsule does and does not defend against.
- [Terms of use](TERMS.md) — how the software is offered.
