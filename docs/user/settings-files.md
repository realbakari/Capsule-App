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
and pull request guidance. A new conversation in the project starts from the
project's defaults too: its permission mode and workspace, and its agent and
mode when a project file names them. Diff layout, folded tool calls and
reasoning follow the project you are looking at.

## In the Settings screen

The Settings screen and the files are two views of the same settings.

- A setting that a file sets carries a small label naming that file: **user
  file**, **project**, **project (local)** or **capsule.json**. Click the label
  to open the file. The arrow beside it resets the setting, which removes it
  from that file, so the next file down, or the default, applies again.
- With a project open, sections whose settings a project can hold show
  **Save to: You · This project · This project, only me**. Changes go to your
  own file, the project's shared `.capsule/settings.json`, or its personal
  `settings.local.json`. Settings a project cannot set always save to your own
  file, and say so when you point at them. While saving to You, a setting that
  the open project's files change is marked **project overrides**.
- **Open settings.json** at the top of a section opens the file Settings is
  saving to, creating it if it does not exist yet.
- Type `@modified` in the settings search to list every setting a file sets.
  Words after it narrow the list, such as `@modified diff`.
- **Restore defaults** removes that section's settings from your user file.
  Values a project's files set still apply in that project.

On a paired phone or browser you can see each setting and the file that set
it, and both follow changes on the computer as they happen, but you cannot
change files, trust a project or reset anything.

## Permission rules

Permission rules answer an agent's permission requests before they reach
you, for every agent Capsule drives, whichever way the conversation runs.

```jsonc
{
  "permissions": {
    "allow": ["execute(pnpm test *)", "fetch(domain:github.com)"],
    "ask": ["execute(git push *)"],
    "deny": ["edit(**/.env*)", "read(~/.ssh/**)"]
  }
}
```

A rule is a kind, and optionally what it covers in parentheses:

| Rule | Covers |
| --- | --- |
| `execute(pnpm test *)` | A command. A trailing ` *` also covers the command on its own. |
| `edit(src/**)`, `read(~/.ssh/**)` | Paths. Relative paths start at the project folder; `**` crosses folders. Also `delete`, `move` and `search`. |
| `fetch(domain:github.com)`, `fetch(domain:*.example.com)` | A host, or its subdomains |
| `mcp(browser:navigate)`, `mcp(browser:*)` | A tool on an MCP server |
| `edit` | Every request of that kind |

Deny wins over ask, and ask over allow. A deny or allow rule answers the
request at once: the agent is refused or approved for that one request. An
ask rule always shows you the request, even when an allow rule matches too.
Each automatic answer is noted in the turn's **Run log**, such as "Allowed by
execute(pnpm test *) in ~/.capsule/settings.json".

An allow rule is strict: every path, and every part of a command joined with
`&&`, `|` or `;`, must match it, and a command that substitutes another
command or writes to a file never matches one. Deny and ask rules need only
one match, and on macOS they ignore the case of a path, so `.ENV` is denied
by `edit(**/.env*)`.

Rules see the request as the agent describes it, and only when the agent
asks. An agent in a mode that never asks reaches no rule.

On an approval card, **Always allow…** shows the rule it would save and
offers **In this thread**, **In this project, only me** (your project-local
file) or **Everywhere** (your user file). It is on the desktop only.
**Settings → Agents → Permission rules** lists every rule with its file,
removes rules from your own files, and adds new ones.

## MCP servers

Add an MCP server once and every agent Capsule starts directly gets it, in
every project or only the ones you name. Settings → Tools (MCP) lists them.

```jsonc
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "docs-mcp-server"],
      "env": { "DOCS_TOKEN": "${env:DOCS_TOKEN}" }
    },
    "tracker": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${env:TRACKER_TOKEN}" },
      "projects": ["~/work/**"]
    }
  }
}
```

- A server with `command` is a local command the agent starts. One with
  `url` is an HTTP server it reaches.
- `${env:NAME}` in `env` and `headers` is read from Capsule's environment
  when a conversation starts, so a token never sits in the file. A server
  whose variable is not set waits, and Settings says which variable.
- `projects` lists folders, with `~` for your home folder and `*` or `**`
  for any name. The server reaches only conversations in a matching project.
- `"enabled": false` turns a server off without deleting it.
- `cwd` sets the folder the server starts in for **Test**. Agents that start
  servers themselves start them where they choose.

In Settings → Tools (MCP), each server shows where its definition lives and
whether the next conversation gets it. **Test** starts the server, or
reaches it, and lists its tools, giving up after ten seconds. With a project
open, the switch turns a server on or off in that project only. Capsule
writes that to the project's `settings.local.json`, so your teammates are
not affected, and **Turn off everywhere** changes your own file.

Where a server reaches:

| Conversation | Local command | HTTP |
| --- | --- | --- |
| Claude Code, direct | Yes | Yes |
| Codex, direct | Yes | Yes |
| Other agents, direct | Yes | When the agent says it supports HTTP servers |
| Muse | No | No |
| Any Gateway thread | No | No |

A Gateway thread uses the tools configured on the Gateway, in its own plugin
settings. A server joins the agent's own servers; it does not replace them.
Servers apply to conversations started after the change.

## Status line

A status line under the composer shows what you want at a glance. Set it up
in Settings → Appearance → Status line, or under `statusLine`.

```jsonc
{
  "statusLine": {
    "items": ["branch", "changes", "context", "limits", "pr", "model", "run"]
  }
}
```

`items` picks from `branch`, `changes`, `context`, `limits` (the usage limit
and when it resets, where the agent reports one), `pr`, `model`, `harness`
(the agent and route), `run` (the latest turn) and `cost` (where the agent
reports it), in the order you list them. An item without a value for the
open thread is left out.

For your own format, name a command instead:

```jsonc
{
  "statusLine": { "command": "~/.capsule/statusline.sh", "refreshInterval": 10 }
}
```

- The command reads the thread as JSON on stdin: `thread_id`,
  `project_dir`, `cwd`, `harness`, `route`, `model`, `context_percent`,
  `rate_limits`, `pr`, `run_status`, `branch`, `changes` and `cost`. A value
  Capsule does not have is `null`.
- It prints up to two lines. Colours and bold, dim, italic and underline
  are kept; anything else in the output is shown as plain text.
- It runs when the thread changes, a turn starts or ends, or the working
  tree changes, at most once a second, and every `refreshInterval` seconds if you
  set one. It has 5 seconds. If it fails, the last line stays dimmed with
  "status line failed", and Settings → Diagnostics shows why.
- Only your own settings file, or a [plugin](./plugins.md) you installed,
  can set a command. A project's file can choose `items`, but not a command.
  Your own `statusLine` replaces a plugin's.

A narrow window shows the first line only; hover it for the rest. A paired
device shows the same line as the desktop, and cannot run the command.

## Response style and personal instructions

`style` picks how replies should read: `concise`, `standard` or
`explanatory`, or the name of a file in your `styles` folder. A style file
is Markdown with a `name` and `description`, and its text is the style.
`personalInstructions` names a Markdown file of your own standing
instructions, such as the tools you prefer. A relative path is in your
settings folder.

Capsule sends both, labelled as standing instructions and not as your
words, before your first message in a conversation, with any agent and on
either route. They are advice the agent reads, not a mode Capsule can
enforce. The older **Output detail** setting still works, and a style
replaces it. Capsule cannot tell when an agent compacts its context, so the
instructions are not sent again after that. A [profile](./profiles.md) can
choose its own style.

## What a project can set

Some settings are yours alone, and Capsule ignores them in a project file:
remote access, Open with entries, other tools' command folders, plugins, a
status line command, HTTP hooks, MCP servers that start a local command, and
personal instructions. A project can still list MCP servers by URL.

## Trusting a project

A project folder may come from someone else, so anything in its settings
that runs code waits until you trust the folder: hooks, MCP servers,
automations and `allow` permission rules. Until then:

- Plain preferences, such as the diff layout or commit guidance, apply at
  once. They cannot run anything.
- `deny` and `ask` permission rules apply at once, because they only make
  agents ask more or do less.
- Turning every hook off with `"disableAllHooks": true` applies at once.
- Turning an MCP server off for the project applies at once. Turning one on
  waits.

Trust is remembered per folder on this computer. Revoking trust puts those
entries back on hold.

When you open a conversation in a project that wants to run something, a
quiet note above the conversation says how many things it would run. **What
would run** lists each one exactly: the hook command, the MCP server address,
the automation or the allow rule, and the file it is in. Choose **Trust this
project** to let them run, or **Not now** to hide the note until Capsule
restarts. You can trust or revoke later from the project's menu in the
sidebar, the command palette, or Settings → Diagnostics.

## When a file has a mistake

If a settings file stops parsing, Capsule keeps using the last version of it
that worked, even across a restart, and reports the line and column of the
problem. A notice at the top of the window names the file and the mistake,
with **Open file**. It appears once for each mistake, and goes away when the
file parses again. Capsule does not write to a file it cannot read, so fix the mistake
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

While Capsule runs this way, a banner reads **Safe mode: customizations are
off.**, and settings cannot be changed, so that nothing is saved over the
files you are about to fix. Edit them in your own editor, then choose
**Restart normally** in the banner or **Restart Normally** from the same menu.

## From the command palette

The palette (⌘K) has the settings files too: **Open user settings**, **Open
project settings**, **Open project local settings**, **Open hooks
settings**, **Open keybindings file**, **MCP servers**, **Status line**,
**Automations**, **Run automation** for each automation, **New conversation
with** each profile, **Reload customizations**, **Trust this project** or **Revoke trust
for this project**, **Restart without customizations** or **Restart
normally**, and **Show customization problems**.
