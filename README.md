# Capsule

A local-first macOS workspace for AI agents.

Capsule sits above OpenClaw. OpenClaw runs agents, tools, skills, sessions, and channels. Capsule provides the workspace: projects, conversations, runs, contracts, verification, approvals, and artifacts.

[Architecture](ARCHITECTURE.md) · [Desktop spec](docs/internals/desktop.md) · [Harnesses](docs/internals/harness.md) · [Agents](AGENTS.md) · [Contributing](CONTRIBUTING.md) · [OpenClaw notes](docs/internals/openclaw.md)

## What you get

- Chat, projects, Inbox (projectless tasks), agents, skills, and run history
- Composer slash commands (`/`), file mentions (`@`), skills (`$`), and permission modes
- A primary project folder plus optional extra folders; Files tree and image/code preview in the inspector
- A simple default view, with execution details on demand
- An OpenClaw Gateway adapter over protocol 4
- Capsule contracts, policies, verification, and artifacts
- A mock runtime so the app works without OpenClaw installed
- ACP harnesses through OpenClaw acpx (`/acp spawn --bind off`, doctor, dedicate, steer, cancel, status, permissions/model/cwd/timeout, close) — Claude Code and Codex first, plus the official acpx catalog. Not a local ACP server.

## Architecture

```
Capsule UI → Capsule Core → Adapters → OpenClaw Gateway / channels
```

The Gateway is the control plane. Capsule never imports OpenClaw internals. Messaging plugins live on the Gateway; Capsule maps them to sessions and runs.

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm package:mac
```

Requires Node 22+ and pnpm 10+. Apple Silicon macOS is the first packaging target.

If `pnpm dev` fails with `Electron uninstall`, the Electron binary was not downloaded (pnpm skipped the install script). Run:

```bash
node scripts/ensure-electron.mjs
pnpm rebuild electron
pnpm dev
```

If the window opens but logs `NODE_MODULE_VERSION`, SQLite was compiled for host Node instead of Electron:

```bash
node scripts/ensure-native.mjs
pnpm dev
```

## First run

1. Launch Capsule.
2. Capsule probes a local OpenClaw Gateway. If none is running, it uses the mock runtime.
3. Create or select a project, start a conversation, pick an agent, send a task.
4. Watch progress, inspect the run, continue the conversation.

Connect a real Gateway from Settings. Tokens stay in the macOS Keychain, never SQLite, never the renderer.

Mock prompt tokens: `[approval]`, `[fail]`, `[verify]`, `[multi]`, `[long]`, `[buzz]`, `[tool]`.

## License

MIT
