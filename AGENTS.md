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

## Words we use

Capsule's vocabulary overlaps with OpenClaw's and with the agents it drives, and
the same word means different things one layer apart. Use these:

- **user** — the person driving Capsule.
- **agent** — the coding CLI a user runs *through* Capsule (Claude Code, Codex,
  Grok Build, Gemini). Not you.
- **harness** — Capsule's record of one such agent: its binary, readiness, login
  state, and how to spawn it. A preset in `@capsule/shared`.
- **runtime route** — who carries a turn to the agent. The **Gateway** route goes
  through OpenClaw's ACP bridge; **direct** mode spawns the CLI from Capsule and
  speaks ACP to it over stdio. A thread keeps the route it started on, and its
  session key says which.
- **project** — a folder Capsule works in, with its own actions and defaults.
- **thread** (a `Session` in code) — one conversation in a project.
- **turn** — one user message and everything the agent did in response.
- **run** — the record of a turn: status, events, result, contract, checkpoint.
- **checkpoint** — a hidden git ref holding what the worktree looked like when a
  turn finished, so a turn can be diffed and restored.
- **session key** — the Gateway's or direct host's own id for a live agent
  session, stored on the thread as `openclawSessionKey`.
- **control command** — `/acp status`, `/acp doctor`, an option change. Capsule's
  own bookkeeping, never the agent speaking, and never a message in a thread.

---

## What not to do on this machine

Capsule is developed on the machine it runs on, often while the developer has it
open. Three ways to break their day:

1. **Killing by pattern.** No `pkill -f capsule`, no `pgrep | kill`, no killing a
   PID you found by matching a name or path. The developer's own Capsule, their
   `pnpm dev`, and their OpenClaw Gateway all match the obvious patterns, and so
   does your own process. Kill only a PID you captured when you spawned it, and
   scope the pattern to a path you created (`--user-data-dir=<your temp dir>`).
2. **Writing to the live profile.** `~/Library/Application Support/@capsule/desktop`
   is the developer's real database and window state, in use while you work.
   Copy out of it freely; never launch against it. Electron reads
   `--user-data-dir` only if it comes **before** the app path — put it after and
   Electron hands the flag to the app as argv and quietly uses the real profile.
3. **Trusting a live file copy.** `cp` of an open SQLite database is a corrupt
   copy unless the `-wal` and `-shm` siblings come too. `VACUUM INTO` is safe
   while a server holds the source open and yields one consistent file.

---

## Test data

An empty database proves nothing. Seed a throwaway profile from the real one:

```bash
SANDBOX=$(mktemp -d)/profile
mkdir -p "$SANDBOX/state"
sqlite3 ~/Library/Application\ Support/@capsule/desktop/state/capsule.sqlite \
  "VACUUM INTO '$SANDBOX/state/capsule.sqlite'"
node -e "import('./scripts/electron-path.mjs').then(m => console.log(m.resolveElectronBinary()))"
# then, with that binary — note the flag order:
#   <electron> --user-data-dir="$SANDBOX" apps/desktop/out/main/index.js
```

Data flows one way: into the sandbox, never back out.

To see the UI without a display, launch that sandbox with `--remote --no-open`
and pair a browser with the URL it prints. The viewer serves the real renderer
and is read-only, which is also the cheapest way to check that a write channel
is classified as one.

---

## Hit every surface

The commonest defect in this repo is a change that works on the path you tested
and is missing on the others. Before calling UI work done, walk this list:

- **Entry points.** A control that belongs in the composer usually also belongs
  in the command palette, the Harnesses view, or Settings. Shipping it in one
  place is not shipping the feature — a model picker that exists only in the
  Harnesses detail panel, and only after someone presses Status, is a picker
  nobody finds.
- **Both runtime routes.** Gateway and direct behave differently. A feature that
  reads a Gateway response needs an answer for direct mode too, even if the
  answer is "not carried here" — said out loud, not silently dropped.
- **Every harness.** Presets differ: some have a native ACP command, some a login
  probe, some neither. A harness-shaped feature needs a decision per preset.
- **Both ways in.** A turn's text can reach a thread as a reply *or* as a run's
  result. A guard on one is not a guard.
- **Reverse states.** If you added a way in, add the way out and the way to see
  it. Dismiss needs a way back. Enable needs disable.
- **The remote viewer.** Anything new on the renderer is reachable from a paired
  device. A new IPC channel is a write channel unless it is listed as a read.

---

## Commits and pull requests

- Never open a pull request unless asked.
- Conventional commit titles in plain language: `fix(chat): stop a status dump
  reaching the thread`.
- The body says what was wrong and why the fix is the right shape. Say what you
  measured when the claim is about speed or size.
- No attribution trailers. Do not add `Co-Authored-By`, and do not name the model
  or tool that did the work.
- Never name another product in shipped material — commits, UI copy, docs.
  Compare against them freely while working; do not put them in the repo.
- One concern per commit. If the message says "also", it is two.

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
5. Docs split by audience, and a change updates the half it touches. Behavior a
   user would notice goes in `docs/user/`, in shipped-product voice with no repo
   tooling or source paths. Architecture and contributor-facing decisions go in
   `docs/internals/`; anything the UI shows also goes in
   [docs/internals/desktop.md](docs/internals/desktop.md), and ACP or Gateway
   behavior in [docs/internals/harness.md](docs/internals/harness.md) /
   [docs/internals/openclaw.md](docs/internals/openclaw.md). Do not ship a
   feature the docs do not describe. The index is [docs/README.md](docs/README.md).

Keep files focused. Prefer a new package over growing `core` into a junk drawer. Prefer extending the OpenClaw adapter over scattering Gateway RPC calls.

---

## Key patterns

**Adapters own I/O.** `OpenClawAdapter` is the only module that constructs `GatewayClient`. `BuzzAdapter` only filters channel rows. `FilesystemAdapter` refuses paths outside the project root.

**Runs are the unit of work.** Every meaningful execution becomes a run with events, optional contract, verification, and artifacts.

**Mock runtime is first-class.** The app must be developable without OpenClaw installed. Prompt tokens `[approval]`, `[fail]`, `[verify]`, `[multi]`, `[long]`, `[buzz]`, and `[tool]` trigger mock scenarios.

**Protocol 4.** Operator clients must send `minProtocol: 4` and `maxProtocol: 4`. Do not regress to protocol 3.

**ACP harnesses are not Capsule runtimes.** Implement the OpenClaw ACP operator lifecycle (doctor, dedicate, spawn `--bind off`, steer, cancel, status, permissions/model/cwd/timeout/set-mode, close) through `@capsule/harness` and `OpenClawAdapter`. Spawn by creating a Gateway session then sending `/acp spawn <id> --bind off` — `--bind here` is for messaging channels, not Capsule’s operator socket. Do not pass `runtime: "acp"` on `sessions.create`, and do not add a Capsule-owned ACP JSON-RPC server. Claude Code, Codex, and Grok Build are first-class; other official acpx ids are spawnable. Grok remains an acpx-owned CLI loop registered through its native `grok agent stdio` command. Code-mode work on a dedicated project must route through the live harness session. Do not treat the `coding` mock agent as a substitute.

**IPC is a closed allowlist.** Adding a renderer capability means adding a named channel in `@capsule/shared` and a handler in `apps/desktop/src/main`. Never expose a generic shell.

---

## Desktop UI

Layout: collapsible sidebar, 52px titlebar (no app mark), centered conversation, glass composer dock, optional inspector. Graphite and off-white matching the Capsule mark — no purple. Slash commands, file mentions, skills, and permission modes belong in the composer. Keep the default conversation free of policy matrices.

The inspector is Launch / Review / Terminal / Browser / Files / Side chat. Files is an in-place expandable tree plus preview (images and code). Terminal is a command runner, not a PTY. Do not reintroduce a current-directory `dir` stack that navigates into folders.

The product spec is [docs/internals/desktop.md](docs/internals/desktop.md). If the UI and that file disagree, fix both in the same change.

Use rem for readable text.

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/internals/desktop.md](docs/internals/desktop.md)
- [docs/internals/harness.md](docs/internals/harness.md)
- [docs/internals/openclaw.md](docs/internals/openclaw.md)
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [Building a Gateway client](https://docs.openclaw.ai/gateway/clients)

