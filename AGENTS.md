# AGENTS.md — Capsule contributor guide for AI agents

This guide is for AI agents working in the Capsule repo. Human setup lives in [CONTRIBUTING.md](CONTRIBUTING.md). System design lives in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Product contract

Capsule is a **workspace**, not a runtime.

- Do not rebuild OpenClaw agent loops, model providers, sessions, tool execution, channel protocols, plugin runtime, or scheduling unless Capsule needs a thin abstraction around them.
- Do not import OpenClaw `src/**`. Use `@openclaw/gateway-client`, `@openclaw/gateway-protocol`, and documented plugin SDK paths.
- Do not implement messaging-channel protocols. Those stay on the Gateway. Capsule maps channel → session → run.
- Do not put Dzaleka, Mentors Outreach, or other personal project names in product copy, fixtures, or docs. Capsule is a generic developer product.
- The default UI must stay simple. Governance details belong behind an expansion, not on the home screen.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before a non-trivial change. Call out any intentional tension with that document.

---

## Repo structure

```
apps/desktop/          Electron main, preload, React renderer
packages/              Domain packages (see ARCHITECTURE.md)
scripts/               Dev tooling (Electron install, desktop launch)
docs/                  Extra notes (OpenClaw protocol, etc.)
ARCHITECTURE.md        System design
AGENTS.md              This file
CONTRIBUTING.md        Human contributor setup
```

The renderer may import `@capsule/shared` and `@capsule/ui` only. Node, SQLite, Keychain, filesystem, and OpenClaw belong in Electron main via `@capsule/core`.

---

## Commands

```bash
pnpm install      # also runs scripts/ensure-electron.mjs
pnpm dev          # desktop app (installs Electron binary if missing)
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm package:mac
```

If `pnpm dev` reports `Error: Electron uninstall`, the Electron postinstall was skipped. Run `node scripts/ensure-electron.mjs`. Do not delete `node_modules` as a first step.

If the window opens but the engine fails with `NODE_MODULE_VERSION`, run `node scripts/ensure-native.mjs`. `better-sqlite3` is compiled for Electron; `pnpm test` therefore runs Vitest under Electron.

---

## Quality gates

Before finishing a change:

1. `pnpm test`
2. `pnpm typecheck`
3. `pnpm lint`
4. For UI changes, `pnpm build` and exercise the first user flow (create project → conversation → send → run → artifact).

Keep files focused. Prefer a new package over growing `core` into a junk drawer. Prefer extending the OpenClaw adapter over scattering Gateway RPC calls.

---

## Key patterns

**Adapters own I/O.** `OpenClawAdapter` is the only module that constructs `GatewayClient`. `BuzzAdapter` only filters channel rows. `FilesystemAdapter` refuses paths outside the project root.

**Runs are the unit of work.** Every meaningful execution becomes a run with events, optional contract, verification, and artifacts.

**Mock runtime is first-class.** The app must be developable without OpenClaw installed. Prompt tokens `[approval]`, `[fail]`, `[verify]`, `[multi]`, `[long]`, `[buzz]`, and `[tool]` trigger mock scenarios.

**Protocol 4.** Operator clients must send `minProtocol: 4` and `maxProtocol: 4`. Do not regress to protocol 3.

**Claude Code and Codex are harnesses, not Capsule runtimes.** Implement the full ACP operator lifecycle (doctor, dedicate, spawn, steer, cancel, status, permissions/model/cwd, close) through `@capsule/harness` and `OpenClawAdapter`. Spawn with `/acp spawn` on a Gateway session — do not add a Capsule-owned ACP JSON-RPC server. Code-mode work on a dedicated project must route through the live harness session. Do not treat the `coding` mock agent as a substitute for Claude/Codex.

**IPC is a closed allowlist.** Adding a renderer capability means adding a named channel in `@capsule/shared` and a handler in `apps/desktop/src/main`. Never expose a generic shell.

---

## Desktop UI

Layout: collapsible sidebar, 52px page header, centered conversation, glass composer dock, optional inspector. Graphite and off-white matching the Capsule mark — no purple. Slash commands, file mentions, skills, and permission modes belong in the composer. Keep the default conversation free of policy matrices.

Use rem for readable text.

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/openclaw.md](docs/openclaw.md)
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [Building a Gateway client](https://docs.openclaw.ai/gateway/clients)

