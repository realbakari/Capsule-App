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

## Commands

Capsule expands its own commands, so a command works the same with every
agent, on both routes, and from a paired device. The agent only ever receives
prompt text.

**Catalog.** `ConfigService.commands(root)` (`commands.ts` in
`@capsule/config`) reads the folders `commandFolders` lists, in precedence
order: the project's `.capsule/commands`, the user's `commands`, plugin
folders (an empty seam the plugins feature fills), then the folders
`commandSources` turns on: `claude-commands` (the project's `.claude/commands`,
then `~/.claude/commands`) and `codex-prompts` (`~/.codex/prompts`). A name's
first file wins; each shadowed file is a warning in `problems`. Other tools'
files are parsed with their unknown frontmatter keys ignored and their names
lowercased, and a Codex prompt counts `$1` as the first argument. Safe mode
reads none. `claude-skills` belongs to the Skills feature and is not read here.

**Change detection.** The reload stamp now covers every command folder of the
user and of each tracked project, so editing a command emits
`config-updated` like a settings edit. Folders of other tools sit outside the
watched settings folders and get their own watch once turned on. The renderer
re-reads `commands:list` on `config-updated`; there is no separate commands
event, because every cause of a different list (a file, `commandSources`,
trust) already publishes `config-updated`.

**Expansion.** `packages/core/src/commands.ts` owns it, and the engine calls
it from `sendAdmittedMessage`, the one point every message passes:

1. `readInvocation` matches `/name args`; only then is the catalog read.
2. On a conversation's first turn, the command's `mode` replaces the
   requested mode and its `workspace` is applied through
   `setSessionWorkspaceMode`. A switch that cannot happen (a live agent, the
   Inbox) becomes a problem, and the turn goes on in the current workspace.
3. `prepareCommand` fills in arguments and resolves `@path` mentions against
   the conversation's folder through `realpath`, refusing any that leave it,
   then validates them like composer attachments. They join the message's
   attachments, so the thread shows them.
4. The user message and run are recorded with what was typed, so the thread,
   the title, run search, retry and auto-resume all re-expand rather than
   replay a stale expansion.
5. `runCommandShell` runs each `` !`cmd` `` span with `runCapped` from
   `@capsule/terminal` (10 s, 16 KB of both streams in arrival order) and
   records each run as `command-shell`. A project-scope command in an
   untrusted folder gets `UNTRUSTED_SHELL` in place of each span. The run sits
   in `startingHarnessRuns` meanwhile, so Stop cancels it before anything is
   sent.
6. The contract and the runtime message carry the expanded text, and a
   `command.expanded` run event names the command, its file, the profile, and
   every problem.

Every caller of `sendMessage` gets this: the composer, the paired viewer
(`sendMessage` is a control channel), queued follow-ups and scheduled
resumes (`FollowUpService.send`), the pull request fixer, and channel routes
and channel jobs. Steering is the one way around it, so `steerHarness` refuses
a command and the renderer's existing fallback queues it instead.

## Permission rules and hooks

**One decision path.** `packages/core/src/request-policy.ts` decides every
permission request, whichever route it came by. `permissionSubject` (shared)
reads the ACP tool call into rule terms: the kind, the command from
`rawInput.command` (a string, or an argv whose `sh -c` script is taken
whole), paths from `locations` and the usual input fields, `rawInput.url`,
and an MCP tool from a `mcp__server__tool` title. The direct reader stores
it on `details.subject` before the preview is clipped; the Gateway adapter
does the same for a relayed tool call or an exec approval's command. Deny
and allow rules answer at once. An ask rule or no rule goes to
`PermissionRequest` hooks, then the person. The answer is synchronous unless
a hook has to run.

**Hooks.** `packages/core/src/hooks.ts` owns `HookRunner` (selection by event
and matcher, execution, the run record), the verdict functions per event, and
`FollowUpLoopGuard`. Commands run through `runWithInput` from
`@capsule/terminal` with the payload on stdin and `CAPSULE_PROJECT_DIR`;
HTTP hooks POST the same body. The engine calls it at four places:
`submitPromptHooks` at the top of `sendAdmittedMessage`, `decidePermissionRequest`
from `bindAcpReplies` and `processRuntimeEvent`, `observeToolCall` from both
tool paths, and `runTurnEndHooks` from the run listener.

**Rule edits.** `capsule:config:editPermissionRule` adds or removes one rule
in the user or project-local file through `ConfigService.editPermissionRule`,
comparing rules by canonical text.

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
| `capsule:app:restart` | write | quit and start again, into or out of safe mode |
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
- **Commands expand in the engine, not in an agent.** An agent's own command
  system differs per harness and route. Expanding in `sendMessage` gives one
  behaviour for every agent and every way a message arrives, and the thread
  keeps the typed text so a retry re-expands.
- **`commands:list` returns `{commands, problems, sources}`, not a bare
  array.** The Settings card needs the problems and the state of the
  `commandSources` toggles, and `ConfigSnapshot` does not carry extended keys.
- **A command's shell state is one field, `none`, `runs` or `needs-trust`.**
  A `shell` boolean beside a separate trusted flag would be two values that
  must agree.
- **A command's `mode` must be an `AgentMode`.** It is checked when the file
  is parsed, so a wrong value is a problem in Settings, not a surprise later.
- **A command's `workspace` applies on the first turn from any device.** A
  paired device cannot create a worktree conversation directly; a command the
  desktop user or the team wrote can. It is the same switch the composer's
  workspace picker makes before a conversation starts.
- **Missing `@` paths stay text.** `@team` in a command is prose more often
  than a typo, so only a path that leaves the folder is reported.
- **Shell output keeps the head, not the tail.** It becomes prompt text, where
  the start of a diff or a log is what a reader needs; a time-limited command
  keeps what it printed.
- **`send: review` is desktop-only.** `commands:expand` returns shell output
  to the caller, so it is a write. A paired device sends the command instead,
  and the desktop expands it as usual.
- **The Commands area lives under Settings → Skills.** Commands and skills
  are both prompt text a person brings to a conversation, and both sit in the
  composer's `/` menu.
- **New conversations leave their defaults to the engine.** The renderer
  used to send the user's `defaultPermission` and `defaultWorkspaceMode`
  when it created a conversation, which hid the project's record and files.
  It now sends neither from New conversation or Send and continue; the
  engine resolves them from the target project, which may not be the open
  one. A first send with no thread sends only the composer's workspace
  choice, which starts from the project's record, then its files.
- **The composer takes a project file's agent and mode only when a project
  file names them.** Applying the effective value on every project switch
  would reset the agent for everyone without project files, and the
  renderer has always started new threads in `code` mode whatever
  `defaultMode` says. Applied once per project, on the first snapshot, so a
  file edit later does not undo a pick in the composer.
- **The renderer's settings come with each snapshot.** `config-updated` and
  `settings-updated` reload `capsule:config:getEffective` and
  `capsule:config:getDiagnostics` together, and the snapshot's user-level
  settings replace the renderer's copy, so a hand edit reaches every screen
  the way a Settings change does.
- **A row names its key; the search catalog repeats it.** `SettingRow` takes
  `setting`, and the catalog entry carries the same `key` for `@modified`. A
  test reads the panels and fails when a keyed catalog entry has no row
  passing that key. Looking rows up by title was rejected: several catalog
  titles are not the row's label.
- **Save to splits by the registry.** A change saved to a project layer
  writes only `both` keys there, through `capsule:config:setValue`; every
  other key, secrets included, still goes through `updateSettings`, which
  keeps the Keychain and derived records in step. The choice resets to You
  when the project changes.
- **Restore defaults stays a user-file operation.** Writing defaults through
  the user save already removes them from the file, because a default-equal
  user value is never written. Project values are left alone and the
  confirmation says so.
- **A broken file is announced once per mistake.** The renderer remembers
  the path and error it announced, forgets a path when it parses again, and
  keeps the record while another project's diagnostics do not mention it,
  so switching projects does not announce the same break twice.
- **Trust in the project menu is for the open project.** The renderer holds
  one project's snapshot. Revoke and Trust appear in the sidebar menu of
  that project; the doctor and the palette have them for it as well.
- **A refused save says why.** The credential rollback replaced every failed
  save's error with fixed text, because a Keychain adapter's message can hold
  a credential. An error from the settings commit itself is Capsule's own,
  such as a broken file's line and column, so it is kept; adapter errors
  still read as before.
- **"Not now" lasts for the run of the app.** It is kept in memory per
  project, so the note returns after a restart rather than never.
- **A blocked prompt is refused before anything is recorded.** No message,
  no run. A PromptSubmit hook is often there to stop a secret, and keeping
  the text in the thread would put it in history, run search and every
  paired device. The send fails with the reason and the hook's file, the
  composer restores the draft, and the hook's run is in the doctor's log.
  There is no run, so there is no run event for it.
- **A queued follow-up a hook blocks leaves the queue.** Retrying the same
  text gets the same answer and would run the hook every 30 seconds. The
  queue's `blocked` reason says it was removed.
- **Hooks may deny an ask-rule request but not allow it.** An ask rule is a
  person saying they want to decide. Among hooks, deny beats ask beats allow,
  so one gate hook asking holds even beside a hook that allows.
- **A hook's `ask` reason goes on the card.** It replaces the approval's
  `reason`, which every device already shows, rather than adding a field.
- **`HookHost.mayAllow` is the seam for less-trusted hook sources.** It
  receives the hook's source and, when false, reads that hook's allow as ask.
  Every file may allow today; a plugin source can be held back there.
- **TurnEnd runs once per run, on completed, failed or blocked, never
  cancelled.** Stop is a person overruling the turn; a follow-up would undo
  that. The excerpt falls back to the run's reply message, because the
  answer can reach a thread as a reply rather than a result.
- **Three hook follow-ups in a row, then the person.** The guard counts hook
  follow-ups since the last message that was not one of them. It is kept in
  memory, so a restart resets it.
- **ToolCall fires once a tool has finished.** Firing on every
  `tool_call_update` would start several processes per tool. Each tool call
  fires once, four observers at a time, without delaying the turn.
- **Deny and ask path rules ignore case on macOS and Windows; allow rules
  stay exact.** A case-insensitive file system makes `.ENV` the same file as
  `.env`; widening allow the same way would approve paths the rule did not
  name. `PermissionContext.caseInsensitivePaths` carries it.
- **A command longer than 4,096 characters is never matched.** The direct
  title was clipped at 512 and previews at 8 KB; a clipped command could
  match an allow rule the full one would not.
- **Always allow writes through its own write channel, desktop only.** A
  paired device approves once. The rule comes from `suggestAllowRule`: a
  command's first two words and ` *`, one exact path, a host, or an MCP tool.
  Adding an allow rule to an untrusted project's local file is refused,
  because it would wait there unused. The team file is not offered; it is
  edited by hand and committed.
- **A rule edit rewrites the `permissions` key.** Comments inside that object
  are lost; comments elsewhere in the file are kept. Editing one array
  element in place would need a path-aware edit the JSONC helper does not
  have yet.
- **`disableAllHooks` from any file wins.** It merged by replace, so a project
  file setting `false` turned the user's `true` back off. It now only turns
  hooks off.
- **A thread without a folder runs only the user's hooks.** Its rules resolve
  relative paths against home, but no project file is read for hooks.
- **A command's worktree needs no trust gate.** A command's `workspace:
  worktree` switch starts the setup actions saved on the project record,
  which are the person's own; the repository's `capsule.json` setup actions
  are not run by that switch, which reads the stored project. A test fails if
  the switch ever starts the repository's scripts; that is the point to add
  a trust gate.
