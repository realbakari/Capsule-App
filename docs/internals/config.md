# Customization and settings files

Capsule drives several agents, so it customizes them from one place. A
developer writes a setting, a command, a hook, a permission rule, a theme or a
key binding once, in a file they can version. It then applies to every agent
Capsule drives, on both runtime routes, on the desktop and from a paired phone.

This document is for contributors. The user-facing pages are
[settings files](../user/settings-files.md), [commands](../user/commands.md),
[hooks](../user/hooks.md), [themes](../user/themes.md) and
[automations](../user/automations.md).

## The rule this design keeps

Capsule is a workspace, not a runtime. It cannot rewrite an agent's system
prompt or stop a tool call inside the agent's loop. Every customization acts at
a seam Capsule owns:

| Seam | What Capsule can do there |
| --- | --- |
| The prompt Capsule sends | expand a command, add context, block it (PromptSubmit) |
| An ACP permission request Capsule answers | allow or deny by rule or hook (PermissionRequest) |
| ACP `session/update` tool events Capsule observes | run observers (ToolCall) |
| A run reaching a terminal status | run observers and queue a follow-up (TurnEnd) |
| `session/new` on the direct route | offer MCP servers |
| Thread creation | apply an agent profile |
| Its own UI | theme, key bindings, status line |

When a route cannot carry something, the UI and docs say so. The Gateway does
not let Capsule offer MCP servers, so MCP servers apply to direct threads only.

## Package

`@capsule/config` lives in Electron main and owns discovery, parsing,
validation, merging, watching, trust and migration. `@capsule/core` asks it for
effective values and does not read customization files itself. The renderer
never reads a file. It receives an effective snapshot with provenance over IPC.

The shared shapes and the key registry live in `@capsule/shared`
(`config.ts`, `settings-schema.ts`). The renderer needs them for provenance
chips and the Settings editor.

The package's modules follow the domain rather than a load, validate, save
sequence:

| Module | Owns |
| --- | --- |
| `jsonc.ts` | reading a JSONC file with error positions, editing a key without losing comments, atomic writes |
| `schema-check.ts` | the JSON Schema subset the registry uses |
| `project-policy.ts` | what a project file may do: user-only parts of keys, and what waits for trust |
| `layers.ts` | one file validated into a layer, and layers merged with provenance |
| `trust.ts` | the trusted-folder store |
| `last-good.ts` | the last good parse of each file |
| `watcher.ts` | live reload |
| `resources.ts` | folders of one-file resources (`commands`, `profiles`, `styles`, `themes`): a kind registry and one lister, so a later feature adds only its parser |
| `migrate.ts` | the one-time export from SQLite |
| `service.ts` | `ConfigService`, the one stateful owner, which the engine exposes as `engine.config` |

## Files

```
$CAPSULE_CONFIG_DIR or ~/.capsule/
  settings.json          user layer
  keybindings.json
  commands/*.md
  profiles/*.md
  styles/*.md
  themes/*.json
  plugins/<name>/        installed plugins (capsule-plugin.json)

<project>/
  capsule.json           unchanged: icon, default workspace mode, actions
  .capsule/
    settings.json        team layer, committed
    settings.local.json  personal layer, added to .git/info/exclude on first write
    commands/*.md
    profiles/*.md
    styles/*.md
    themes/*.json
```

Every settings file is JSONC. Comments and trailing commas are allowed, and
Capsule's own writes keep them, because edits go through `jsonc-parser`'s
`modify`. A file names its schema with `"$schema"`, and Capsule writes that key
when it creates a file.

## Precedence

From high to low:

1. A thread's own choice (model, mode, permission picked in the composer).
2. A choice stored on the project record in Capsule (a dedicated agent, a
   workspace mode picked on the project screen).
3. `.capsule/settings.local.json`
4. `.capsule/settings.json`
5. `capsule.json`, for its one legacy key, `defaultWorkspaceMode`
6. `~/.capsule/settings.json`
7. Built-in defaults

Scalars and arrays of values replace. Maps merge by key (`mcpServers`,
`themeOverrides`, `commandSources`, `plugins`), and `automations` merge by
`id`, so a project adds an automation without hiding the user's. Rule lists
concatenate across layers (`permissions.allow`, `permissions.ask`,
`permissions.deny`, and each hook event's matcher groups). Rules, hook
groups, MCP servers and automations are delivered as `Sourced<T>` entries
that carry the file they came from (`EffectiveExtendedConfig` in
`@capsule/shared`); every other key has one provenance for the whole value.

The engine reads a project's layers for what a project may set, at the
points it already used a setting: a new conversation's permission,
workspace mode and agent (the agent only when the caller names no mode),
and each turn's contract and agent instructions (output detail, sandbox,
web access, commit and pull request instructions).

## The key registry

`SETTINGS_SCHEMA` in `@capsule/shared` declares each key once:

- its section
- its scope, `user` (only the user file may set it) or `both`
- its JSON Schema fragment
- whether it applies live or to the next thread

Validation, the Settings editor's provenance, Reset and the published JSON
Schema all come from that table. `scripts/gen-settings-schema.mjs` writes
`schemas/settings.schema.json`, and `pnpm lint` fails when the committed file
and the registry disagree. The script bundles the registry with esbuild in
memory, because its `.js` imports are not resolvable by Node's type
stripping.

Validation is a small checker over the subset of JSON Schema the registry
uses (type, enum, const, pattern, properties, additionalProperties, items,
required, oneOf, minimum, maximum, maxLength). It drops the smallest wrong
part: an array item, an object property, or the whole key when the key's
own type is wrong. Unknown keys are warnings; wrong values are errors. A
secret written into a file is ignored with a warning that says where
secrets live.

## Trust

A project file can describe things that run code: hooks, `` !`cmd` `` in
commands, MCP servers, automations and status line commands. Capsule honours
those entries only after the user trusts the folder. Trust is per folder and
stored in SQLite (`config.trustedFolders`). Until a folder is trusted:

- Executable entries load as "waiting for trust". They are listed in the
  doctor with a Trust button.
- Plain preferences (default agent, diff layout, instructions) apply at once.
  They cannot run anything.
- `permissions.deny` and `permissions.ask` apply at once, because they only
  restrict. `permissions.allow` waits for trust.

Some keys are user-only and are never read from a project file. These are
`statusLine.command`, hooks of type `http`, MCP `command` and `env`, `openWith`,
`commandSources`, `plugins` and `remoteAccess`. A project that sets one gets a
warning in the doctor, and the value is ignored. Top-level user-only keys
come from the registry's `scope`; the parts of a key a project may otherwise
set (`statusLine.command`, an `http` hook, an MCP server with `command` or
`env`) are stripped by `@capsule/config`'s project policy. A project can
therefore only declare MCP servers by URL.

`disableAllHooks` applies from an untrusted project. It can only turn hooks
off, or leave the user's own hooks on, and neither runs anything.

Revoke is the reverse of Trust. It is in the doctor, the project menu and the
command palette.

## Reload and broken files

`fs.watch` on the user folder and on each open project's `.capsule/` folder
(recursive), and on its `capsule.json`, re-parses after a 150 ms quiet
period. A path that does not exist yet is polled once a second instead of
watched through its parent: on macOS a folder watch streams events for the
whole tree beneath it, and a project root's tree holds its dependencies.
After each quiet period a watch whose path was replaced is re-attached,
which follows editors that save by rename.

The service tells its listeners only about changes it finds on disk. Its own
writes and trust changes return synchronously and the caller publishes them,
so the engine's save, which writes the file inside a SQLite transaction, is
never re-entered halfway. The engine then emits `settings-updated` when the
user-level settings changed and `config-updated` for every change, and main
reapplies the desktop settings on `config-updated`, so a hand edit behaves
like a change in the Settings screen.

A file that fails to parse keeps its **last good** value. The last good parse of
every file is written to `<userData>/config-last-good/`, so a file broken while
Capsule was closed still loads its last good value on the next launch. The
doctor names the file, the line and the parser message. An entry that fails
validation is skipped on its own, and the rest of the file applies.

## Migration

The first launch of a build with settings files exports the SQLite
`CapsuleSettings` row to `~/.capsule/settings.json`. Only values that differ
from the defaults are written, so the file starts small and every line in it is
a real choice. Secrets stay in the Keychain and are never written to a file.
The migration records `config.migratedAt` in SQLite and never runs again. The
old row stays in the database, untouched, as a backup. If a user file already
exists, nothing is exported and only `config.migratedAt` is recorded.

Key bindings in the old row move to `keybindings.json` as one `global` block,
with `meta` renamed `cmd`, and only when that file does not exist yet. The
row's normalization never kept them, so most profiles have none to move.

Secrets that very old builds left in the row still move to the Keychain on
launch, and are then stripped from the row.

From then on the user file is the source of truth for preferences. SQLite keeps
state: windows, drafts, trust and secret references.

## Writing back

The Settings UI writes to the file that should hold the value:

- A user-scope key goes to `~/.capsule/settings.json`.
- A `both` key goes to the layer the user picked in the "Save to" control, which
  is shown when a project is open.
- Writing a value equal to the default removes the key from the user file. A
  project file keeps it, because there a default-equal value still overrides
  a person's own setting.
- Reset removes the key from the file that set it, and shows what the value
  falls back to.
- A write is refused, with the line and column, while the target file does
  not parse, so Capsule never rewrites a file it cannot read.
- The first write that creates `settings.local.json` adds its path to the
  repository's `info/exclude` (the main repository's, for a worktree), once.

The Settings screen's existing save path writes the changed keys to the user
file as the last step of its SQLite transaction. A failed file write rolls
back the derived policy and inbox records and the Keychain changes. After a
save, the published settings are re-read from the file, so an edit that
landed while the save ran is not lost.

## IPC

| Channel | Scope | Purpose |
| --- | --- | --- |
| `capsule:config:getEffective` | read | effective snapshot and provenance, optionally for a project |
| `capsule:config:getDiagnostics` | read | sources, problems, trust queue, hook and status line runs |
| `commands:list` | read | Capsule commands for a project |
| `capsule:config:setValue` | write | write or remove a key in one layer |
| `capsule:config:openFile` | write | create a file from a template if missing, then open it |
| `capsule:config:trust` | write | trust or revoke a project folder |
| `capsule:config:reload` | write | re-read every file now |
| `commands:expand` | write | expand a command for review in the composer. It may run `!` |

Main checks each write's shape where it crosses: a key and a known layer, or
a file target naming one of the known kinds and folders, so the renderer
cannot ask main to open an arbitrary path.

Every new channel other than the three reads is a write, so a read-only paired
viewer and the phone cannot change configuration.

## Safe mode

`--safe-mode`, `CAPSULE_SAFE_MODE=1` for a dev run, or "Restart Without
Customizations" in the app menu (the File menu off macOS) and the palette,
starts Capsule with built-in defaults and Keychain secrets only. No settings
file, command, hook, profile, rule, theme, key binding, MCP server,
automation or plugin loads, and the migration does not run. A persistent
banner offers "Restart Normally", which is also the menu item in safe mode.

In safe mode a preference save is refused with "Safe mode is on. Restart
normally to change settings files." A save that only changes a Keychain
secret still works, and opening a file still works, because that is how a
broken file gets fixed. The relaunch is registered on `will-quit`, so
choosing "Keep working" over running turns cancels it.

## The settings folder

Main passes the engine `CAPSULE_CONFIG_DIR`, else `~/.capsule`. A profile
launched with its own `--user-data-dir`, and the smoke test, use
`<userData>/state/capsule-home` instead, which is also the engine's default
when no folder is passed. A sandbox seeded from a real database therefore
migrates into itself, never into the developer's `~/.capsule`. The last good
copies live in `<userData>/state/config-last-good/`, one file per settings
file, named by the SHA-1 of its path.

A `--remote` reach given at launch holds for that launch. Reapplying the
desktop settings after a save or a file edit no longer closes it.

## Decisions

Decisions made while building this, and why.

- **Profiles live in `profiles/`, not `agents/`.** In Capsule's vocabulary an
  agent is the coding CLI. A file that bundles an agent with a model and a
  policy is a profile, and the folder says so.
- **Secrets are not referenced from the file.** The report suggested
  `{"keychain": "gateway"}`. Capsule already holds exactly two secrets in the
  Keychain under fixed accounts, so a reference adds a shape without a use.
- **A value equal to the default is removed, not written, from the user
  file.** The file stays a list of real choices, and provenance never shows
  "set in settings.json" for something the user did not change. Project files
  keep such a value, because removing it would let a teammate's own setting
  win over the team's.
- **Validation drops the smallest wrong part.** One malformed permission rule
  or one bad palette colour is skipped on its own, rather than the key it
  sits in.
- **Automations merge by id, not replace.** An automation is an entry, not a
  scalar; a project adding one must not hide the user's.
- **No parent-folder watches.** Missing paths are polled. Watching a project
  root on macOS streams its whole tree, dependencies included, into the main
  process.
- **Listeners hear only changes found on disk.** The engine's save writes the
  file inside a transaction; a synchronous change event from that write would
  publish before the transaction committed.
- **A sandbox profile gets its own settings folder.** Otherwise the first
  sandbox launch migrates a copy of someone's database into their real
  `~/.capsule`.
- **The agent from a settings file applies only when no mode is given.** A
  mode names its own agent, and the pull request fixer starts `code` threads
  with no agent; a user's chat agent must not take those over. The agent must
  exist, or be a harness id.
- **`defaultMode` stays applied by the renderer.** A project record always
  carries a mode, so an engine fallback to the file would never be reached.
- **Not yet project-aware.** Git and pull request actions (branch prefix,
  force-with-lease, draft, merge method, auto-merge, review delivery) still
  read the user-level settings. They should read the project's layers next.
- **The renderer still sends user-level defaults.** It passes the user's
  `defaultPermission`, `defaultWorkspaceMode` and agent when it creates a
  conversation, so the engine's project-layer fallbacks reach only threads
  the engine starts itself. The composer should read
  `ProjectConfigSnapshot.settings` (`capsule:config:getEffective` with a
  project id) for these defaults.
