# Plugins

A plugin is a folder that brings a whole setup at once: commands, profiles,
response styles, themes, skills, hooks, MCP servers and a status line. A team
keeps one in a repository, and everyone installs it from the repository's
address.

Capsule reads a plugin as files. Before anything installs you see exactly
what it adds, and nothing in it runs until you have seen that list and
installed it.

## Installing one

Settings → Plugins, or the Plugins tab in the skills library, installs from:

- **a folder** on this computer, which Capsule copies;
- **a zip**, which Capsule opens into a folder of its own;
- **a Git address** (`https://…`, `ssh://…` or `git@host:team/repo`), which
  Capsule clones once, without history.

Capsule copies the plugin into a folder it controls first, without links,
`.git` or anything past 5,000 files or 50 MB, and reads that copy. The install
screen lists:

- every hook, with its event and the command line or URL it runs;
- every command, marking the ones that run shell (`` !`…` ``) with what they
  run;
- every MCP server, with its command line or URL;
- the status line, and its command if it has one;
- themes and the backdrops they draw;
- profiles, response styles and skills;
- the plugin's options, as a form.

When the plugin can run anything, the screen also says: "Hooks and shell in
commands run with your user account's rights."

What you install is that copy, so the plugin cannot change between being
listed and being installed. It lands in `~/.capsule/plugins/<name>/`.

Installing a plugin that is already installed replaces it, and the button
says so: "Update from 1.3.0 to 1.4.0", "Reinstall 1.4.0", or "Go back from
1.4.0 to 1.3.0". Your options for it and whether it is on are kept.

## On, off, and removing

Each plugin in the list has a switch. A plugin that is off adds nothing:
its commands, themes and skills disappear and its hooks and servers stop.
A new plugin is turned on when you install it, unless it needs an option
you have not filled in yet; then it waits, and the list says which.

**Uninstall** removes the plugin's folder, its saved options and its secrets.
For a folder loaded for development (below), **Remove** stops loading it and
leaves the folder alone.

The command palette has "Install plugin from folder", "Install plugin from
zip", "Validate plugin folder", "Load plugin from folder (development)", and
"Turn on" or "Turn off" for each installed plugin.

Safe mode loads no plugin.

## Approving requests

A plugin's permission hooks may refuse a request or ask you about it. By
default they may **not** approve one: when a plugin's hook answers allow,
Capsule shows you the request as a question instead, and the customization
log says so.

To let a plugin approve requests on its own, open it in Settings → Plugins and
turn on **Let this plugin approve requests**. That is stored as
`plugins.<name>.mayApprove` in your settings file.

Hooks in your own settings files are not affected; this is for plugins only.

## Options

A plugin can ask for options. Each has a type:

| Type | The form shows |
| --- | --- |
| `string` | a text field |
| `number` | a number field |
| `boolean` | a switch |
| `enum` | a menu of the plugin's choices |
| `path` | a text field for a path |
| `secret` | a password field |

You fill them in on the install screen, or later under the plugin in
Settings → Plugins. A secret is kept in the Keychain and never written to a
file. Other values are kept in `~/.capsule/plugin-data/<name>/config.json`,
which an update leaves in place.

## Writing a plugin

A plugin is a folder with `capsule-plugin.json` at the top:

```jsonc
{
  "name": "team-setup",
  "version": "1.4.0",
  "description": "Our commands, review hooks and theme.",
  "author": { "name": "Platform team" },
  "capsule": ">=0.11",
  "contributes": {
    "commands": "./commands",
    "profiles": "./profiles",
    "styles": "./styles",
    "themes": "./themes",
    "skills": "./skills",
    "hooks": "./hooks.json",
    "mcpServers": "./mcp.json",
    "statusLine": { "items": ["branch", "context"], "command": "sh \"${PLUGIN_ROOT}/line.sh\"" }
  },
  "userConfig": {
    "region": { "type": "enum", "title": "Region", "options": ["eu", "us"], "default": "eu" },
    "api_token": { "type": "secret", "title": "API token", "required": true }
  }
}
```

- `name`, `version`, `description` and `author.name` are required. A name is
  lowercase letters, digits and dashes. Names that would pass for part of
  Capsule are refused: `capsule`, anything starting `capsule-`, the names of
  built-in commands and agents, and the names of bundled themes.
- `version` is a semantic version such as `1.4.0`.
- `capsule` is the range of Capsule versions the plugin works with:
  `>=0.11`, `^1.2`, `~1.2`, `1.2.3`, or several joined by spaces.
- Folders are relative to the plugin's top and must stay inside it. Leave a
  folder out of `contributes` and Capsule still reads it if it exists under
  its usual name (`commands/`, `themes/` and so on).
- `hooks` and `mcpServers` are a JSON file inside the plugin, or the object
  itself. They have the same shape as in a [settings file](./settings-files.md);
  a file may also wrap them in `{"hooks": …}` or `{"mcpServers": …}`.
- Files in the folders are the same as your own: [commands](./commands.md),
  [profiles](./profiles.md), response styles, [themes](./themes.md), and
  skills as `skills/<name>/SKILL.md`.
- `actions` are not read from plugins yet; Validate says so.

### Variables

Hooks, MCP servers, commands and the status line command can use:

| Written | Becomes |
| --- | --- |
| `${PLUGIN_ROOT}` | the plugin's folder |
| `${PLUGIN_DATA}` | a folder for the plugin's own data, kept across updates |
| `${user_config.NAME}` | the option `NAME` |

In a hook or status line command, an option becomes a reference to an
environment variable, `${CAPSULE_USER_CONFIG_NAME}`, which holds its value.
The value is never pasted into the command line, so an option cannot turn
into shell. The command also gets `CAPSULE_PLUGIN_ROOT` and
`CAPSULE_PLUGIN_DATA`.

A secret only reaches environment variables: a hook's environment, or an MCP
server's `env` and `headers`. Written anywhere else, such as a command's text
or a server's arguments, it is left out and Validate names the place.

### Where a plugin ranks

A plugin ranks below your own files. Your command, theme, profile or style of
the same name wins over the plugin's, and a status line in your settings file
replaces the plugin's. Hooks and MCP servers add to yours; a server you define
with the same name replaces the plugin's.

## Developing a plugin

**Validate plugin folder…** (in Settings → Plugins and Settings →
Diagnostics) runs every check on a folder and shows the install screen
without installing anything.

**Load folder for development…** registers a folder in place, without
copying it. It is marked **dev** in the list. Capsule watches the folder and
picks up each save, as it does for your settings files; Reload in
Diagnostics reads everything again at once.

### Examples

Two small plugins that pass Validate are in the Capsule repository under
`docs/examples/plugins/`:

- **approval-gate** adds a permission hook that approves test and lint runs,
  refuses force pushes and recursive deletes, and leaves everything else to
  you. The commands it approves are an option. Turn on "Let this plugin
  approve requests" for its approvals to take effect.
- **git-status-line** adds a status line command with the branch and the
  number of changed files, a label and a colour you choose, and an
  `/explain-diff` command.
