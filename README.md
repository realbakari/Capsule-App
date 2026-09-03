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

Capsule is an open-source, local-first desktop workspace designed for orchestrating autonomous AI coding agents and harness sessions on macOS.

While engines like OpenClaw and ACP run the execution loops, Capsule provides the **human-in-the-loop workspace**: projects, run inspection, diff review, file touches, governance contracts, and artifact tracking.

### ✨ Key Features

- 🖥️ **First-Class Coding Harnesses**: Direct operator lifecycle management for Claude Code, OpenAI Codex, Grok Build, and OpenClaw agents (`/acp spawn --bind off`, steer, doctor, cancel, permissions, and timeout controls).
- 🔍 **Run Inspector & Review**: Detailed execution history with per-turn touched files summaries, additions/deletions tracking, code diffs, terminal outputs, and artifacts.
- 💬 **Glass Composer Dock**: Slash commands (`/`), file mentions (`@`), skills (`$`), and permission toggles built into a clean, minimalist interface.
- 🔒 **Local-First & Secure**: Model keys and gateway tokens stay in macOS Keychain—never in plain text, SQLite, or web renderers. No analytics, no telemetry.
- 🧪 **Offline Mock Runtime**: Develop, test, and explore agent workflows completely offline without an active OpenClaw installation or API keys using trigger tokens (`[approval]`, `[verify]`, `[multi]`, `[tool]`, etc.).
- 🚀 **Signed & Apple Notarized**: Official macOS Apple Silicon builds (`.dmg` / `.zip`) with Hardened Runtime and Apple notarization—no Gatekeeper warnings.

---

## 📦 Installation

Download the latest Apple Silicon DMG from GitHub Releases:

📥 **[Download Capsule v0.1.0 (.dmg)](https://github.com/realbakari/Capsule-App/releases/latest)**

1. Open `Capsule-0.1.0-arm64.dmg`.
2. Drag **Capsule** into your **Applications** folder.
3. Launch Capsule!

---

## 🛠️ Developer Quickstart

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

## 🏗️ Architecture

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

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before submitting pull requests.

1. Fork the repo & create your feature branch: `git checkout -b feat/my-feature`
2. Ensure tests and lint pass: `pnpm test && pnpm lint && pnpm typecheck`
3. Commit your changes: `git commit -m "feat: my new feature"`
4. Push to your branch & open a Pull Request!

---

## 📄 License

MIT © Bakari Mustafa
