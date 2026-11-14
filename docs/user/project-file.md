# capsule.json

A project can carry its own configuration in the repository. Put `capsule.json`
at the root of the project folder and everyone who opens it in Capsule gets the
same actions, the same icon, and the same default for where new conversations
run — without adding anything by hand.

```json
{
  "iconPath": "assets/logo.svg",
  "defaultWorkspaceMode": "worktree",
  "actions": [
    {
      "name": "Setup",
      "command": "pnpm install",
      "runOnWorktreeCreate": true
    },
    {
      "name": "Dev server",
      "command": "pnpm dev",
      "previewUrl": "localhost:5173"
    },
    {
      "name": "Check",
      "command": "pnpm typecheck && pnpm lint",
      "check": true
    }
  ],
  "prompts": [
    {
      "name": "Review",
      "description": "Review one file",
      "prompt": "Review {{file}} for {{focus:bugs|performance|readability}} and list what you would change."
    }
  ]
}
```

## What it can set

| Field | Meaning |
| --- | --- |
| `iconPath` | A workspace-relative image used as the project icon. Checked before Capsule's own guesses. |
| `defaultWorkspaceMode` | `"local"` to run new conversations in the project folder, `"worktree"` to give each one an isolated checkout. |
| `actions` | Commands available from the top bar, up to 50. |
| `prompts` | Saved prompts for the composer's `/` menu, up to 50. |

Each action takes:

| Field | Meaning |
| --- | --- |
| `name` | What it is called. Required. |
| `command` | What it runs, from the project root. Required. |
| `previewUrl` | Opened in Capsule's browser panel when the action runs. |
| `runOnWorktreeCreate` | Runs once, automatically, when a conversation gets its own worktree. For the install step a fresh checkout needs. |
| `openPreview` | Set to `false` to keep the preview from opening by itself. |
| `check` | Set to `true` to make this the project's check: `@diagnostics` in the composer runs it and attaches the output. |

Each prompt takes:

| Field | Meaning |
| --- | --- |
| `name` | What it is called. Typing `/` and the name in the composer finds it. Required. |
| `prompt` | The text. `{{name}}` is a blank to fill in; `{{name:one|two}}` is a choice. Required. |
| `description` | A short line shown in the `/` menu. |

Choosing a prompt with blanks opens a small form for them, then puts the
filled-in text in the composer for you to read and send.

## Who wins

Settings you choose in Capsule outrank the file, and the file outranks the
app-wide default:

- **Workspace** — the conversation's own choice, then the project's setting,
  then `capsule.json`, then Settings.
- **Icon** — a picture you chose for the project, then `iconPath`, then
  whatever Capsule finds in the folder.
- **Actions** — the file's actions are listed first, marked `shared`. An action
  you add on this machine with the same name replaces the shared one, so you
  can change a command locally without editing the repository.
- **Prompts** — the file's prompts are listed first, marked **Project**. Your
  own saved prompts from **Settings › General › Saved prompts** follow, marked
  **Personal**; one with the same name as a project prompt is hidden.

A shared action cannot be edited or deleted from the project screen. It comes
from the file; change it there and everyone gets the change.

## When it is wrong

A `capsule.json` that is present but unreadable is reported on the project
screen, with the parser's complaint, and everything it declares is ignored
until it is fixed. Capsule does not silently skip it.

The file must be a regular file no larger than 256 KiB. Pipes, devices and links
that leave the project are rejected. File previews and project-scoped reads
also refuse links outside the project; they do not expand Capsule's workspace
access to the rest of the machine.

An entry that is missing a name or a command is skipped on its own — one typo
does not throw away the rest of the file.
