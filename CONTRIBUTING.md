# Contributing to Capsule

Thanks for wanting to help. Capsule is a local-first macOS workspace for AI agents, sitting above OpenClaw.

## Before you open a PR

Read [ARCHITECTURE.md](ARCHITECTURE.md). Capsule should not grow an agent runtime or a messaging protocol.

For anything beyond a small fix, say what problem you are solving and which package owns the change.

## Setup

| Tool | Version |
|------|---------|
| macOS | Apple Silicon preferred |
| Node.js | 22+ |
| pnpm | 10+ |
| Optional OpenClaw Gateway | `openclaw gateway` on `127.0.0.1:18789` |

```bash
git clone <this-repo> && cd Capsule
pnpm install
pnpm dev
```

`pnpm install` downloads the Electron binary. If `pnpm dev` still says `Electron uninstall`, run:

```bash
node scripts/ensure-electron.mjs
pnpm rebuild electron
```

If the app opens but the engine fails with `NODE_MODULE_VERSION`, rebuild SQLite for Electron:

```bash
node scripts/ensure-native.mjs
```

Without a Gateway, Capsule uses the mock runtime. Settings → Connect attaches to a real Gateway.

Desktop icons are derived from `assets/logo.png` and given a macOS squircle mask. Do not edit that file to change the Dock, tray, or `.icns` — regenerate instead:

```bash
pnpm icons
```

## Commands

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm package:mac
```

## Code style

- TypeScript, strict, ESM
- Renderer: no Node, no OpenClaw, no secrets
- Explicit IPC only
- Tests for domain logic (contracts, policies, verification, engine flow)

## Pull requests

One logical change. New behavior has tests. User-facing UI includes a short description of the flow you exercised. Architecture or protocol changes update `ARCHITECTURE.md` and `docs/internals/openclaw.md`. User-visible desktop behavior updates `docs/internals/desktop.md`. ACP / harness behavior updates `docs/internals/harness.md`. Do not ship a feature the docs do not describe — that is how the product drifts.

## License

MIT. By opening a PR you offer the change under the same license.
