# Contributing to Capsule

Thanks for wanting to help. Capsule is a local-first desktop workspace for AI agents, sitting above OpenClaw.

## Before you open a PR

Read [ARCHITECTURE.md](ARCHITECTURE.md). Capsule should not grow an agent runtime or a messaging protocol.

For anything beyond a small fix, say what problem you are solving and which package owns the change.

## Setup

| Tool | Version |
|------|---------|
| OS | macOS Apple Silicon or Windows 10/11 x64 (preview) |
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

Normal launches do not substitute a mock when the Gateway is unavailable.
Connect a Gateway for Gateway-only harnesses, or use direct mode with a native
ACP CLI. Tests select mock execution explicitly with `autoConnect: false`;
the engine first-flow tests need no provider account.

Direct-session unit fixtures must stub both process liveness and transport calls.
Make unexpected native spawns fail immediately: a saved session key alone does
not represent a running process. Protocol integration tests should launch only
their own fixture process, never a signed-in CLI from the developer's PATH.

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
pnpm package:windows # Native Windows x64 host only
```

## Code style

Windows native-module builds require Visual Studio C++ build tools, the Windows
SDK and Python. Project actions use PowerShell on Windows and zsh on macOS;
write actions for the host OS rather than assuming shell syntax is portable.
Release CI tests command shims, native PTYs, ACP fixtures, a mock first flow,
renderer interactions and an actual NSIS install/start/uninstall on Windows.
The full macOS suite remains a separate gate. Windows credentials are not
required for the explicitly unsigned preview; macOS signing remains mandatory.

- TypeScript, strict, ESM
- Renderer: no Node, no OpenClaw, no secrets
- Explicit IPC only
- Tests for domain logic (contracts, policies, verification, engine flow)

## Pull requests

One logical change. New behavior has tests. User-facing UI includes a short description of the flow you exercised. Architecture or protocol changes update `ARCHITECTURE.md` and `docs/internals/openclaw.md`. User-visible desktop behavior updates `docs/internals/desktop.md`. ACP / harness behavior updates `docs/internals/harness.md`. Do not ship a feature the docs do not describe — that is how the product drifts.

## License

MIT. By opening a PR you offer the change under the same license.
