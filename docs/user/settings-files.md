# Settings files

Your Capsule preferences live in plain files you can read, edit, version and
share. The Settings screen writes to them, and an edit you make in your own
editor takes effect within a moment, without restarting.

## The three files

| File | What it is for |
| --- | --- |
| `~/.capsule/settings.json` | Your own settings, for every project. |
| `<project>/.capsule/settings.json` | The team's settings for one project. Commit it. |
| `<project>/.capsule/settings.local.json` | Your personal settings for one project. Never committed. |

When Capsule first creates `settings.local.json` in a Git repository, it
adds the file to that repository's local exclude list, so it never shows up
as a change to commit. Your `.gitignore` is not touched.

A project's `capsule.json` keeps working as before. Its default workspace
mode counts as a project setting, below `.capsule/settings.json`.

## Writing a settings file

Settings files are JSON with comments. Comments and trailing commas are
allowed, and when Capsule changes a value it keeps your comments and layout.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/realbakari/Capsule-App/main/schemas/settings.schema.json",
  // Wider transcript on the big monitor.
  "transcriptWidth": "wide",
  "diffLayout": "unified",
  "commitInstructions": "Use the imperative mood. Keep the subject under 60 characters.",
}
```

The `$schema` line lets your editor complete setting names and flag a wrong
value as you type. Capsule adds it to every file it creates.

A file holds only the choices you made. When you set something back to its
default in the Settings screen, Capsule removes it from your user file
rather than writing the default in.

## Which value wins

From strongest to weakest:

1. What you pick for one conversation, such as its permission mode.
2. A choice saved on the project in Capsule, such as a dedicated agent.
3. `.capsule/settings.local.json`
4. `.capsule/settings.json`
5. `capsule.json`
6. `~/.capsule/settings.json`
7. Capsule's built-in defaults.

Most settings take the strongest value. A few combine instead:

- Permission rules (`permissions.allow`, `ask` and `deny`) and hooks add up
  across files, so a project's rules join yours.
- MCP servers combine by name, and automations by id. A project can add one
  without hiding yours, and a project entry with the same name replaces
  yours in that project.

In a project, what Capsule sends with each message follows the project's
files from the next message: output detail, sandbox, web access, and commit
and pull request guidance. The defaults the composer offers for a new
conversation (agent, permission mode, workspace) still come from your own
settings.

## What a project can set

Some settings are yours alone, and Capsule ignores them in a project file:
remote access, Open with entries, other tools' command folders, plugins, a
status line command, HTTP hooks, and MCP servers that start a local command.
A project can still list MCP servers by URL.

## Trusting a project

A project folder may come from someone else, so anything in its settings
that runs code waits until you trust the folder: hooks, MCP servers,
automations and `allow` permission rules. Until then:

- Plain preferences, such as the diff layout or commit guidance, apply at
  once. They cannot run anything.
- `deny` and `ask` permission rules apply at once, because they only make
  agents ask more or do less.
- Turning every hook off with `"disableAllHooks": true` applies at once.

Trust is remembered per folder on this computer. Revoking trust puts those
entries back on hold.

## When a file has a mistake

If a settings file stops parsing, Capsule keeps using the last version of it
that worked, even across a restart, and reports the line and column of the
problem. Capsule does not write to a file it cannot read, so fix the mistake
first.

A setting with a wrong value is skipped on its own, and the rest of the file
still applies. If one permission rule is malformed, the others still count.
Unknown settings are reported and ignored. A password or token written into
a settings file is ignored too: Capsule keeps those in the Keychain only.

## Moving from earlier versions

The first time you open a version of Capsule with settings files, it writes
your current preferences to `~/.capsule/settings.json`. Only the choices
that differ from the defaults are written, so the file starts short. Your
Gateway token and other secrets stay in the Keychain and are never written
to a file. Custom keyboard shortcuts move to `~/.capsule/keybindings.json`.

This happens once. If `~/.capsule/settings.json` already exists, Capsule
leaves it as it is.

To keep your settings folder somewhere else, such as inside a dotfiles
repository, start Capsule with the `CAPSULE_CONFIG_DIR` environment variable
set to that folder.

## Starting without customizations

If a settings file or something it turns on stops Capsule from working,
choose **Restart Without Customizations** from the Capsule menu (the File
menu on Windows). Capsule restarts with its built-in defaults and your
Keychain secrets, and reads no settings file. You can also start it with
`--safe-mode`.

While Capsule runs this way, settings cannot be changed, so that nothing is
saved over the files you are about to fix. Edit them in your own editor, then
choose **Restart Normally** from the same menu.
