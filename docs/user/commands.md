# Commands

A command is a Markdown file whose text becomes your message. Save
`review-pr.md` in your commands folder, type `/review-pr 123` in any
conversation, and Capsule sends the agent the file's text with `123` filled
in. Capsule expands the command itself, so the same command works with every
agent, whether the conversation runs through the Gateway or directly, and from
a paired phone or browser.

The conversation keeps what you typed, `/review-pr 123`. The agent receives the
expanded text. The turn's **Run log** has a `command.expanded` line naming the
file it came from, and anything that went wrong while expanding it.

## Where commands live

| Folder | Who it is for |
| --- | --- |
| `<project>/.capsule/commands/` | The team. Commit it with the project. |
| `~/.capsule/commands/` | You, in every project. |

A file in a subfolder gets the folder's name in front: `git/commit.md` is
`/git:commit`. Names use lowercase letters, digits, `-` and `_`.

**Settings → Skills → Commands** lists every command Capsule found, where each
one came from, and any problem with its file. It also opens either folder for
you, creating it if needed. An edit to a command file takes effect at once.

## Writing a command

```markdown
---
description: Review a pull request
argument-hint: <number> [focus]
arguments: [number, focus]
---
Review pull request #$number. Pay most attention to $focus.

The diff:
!`gh pr diff $number`

Our review checklist is in @docs/review.md.
```

The block between the `---` lines is optional. It can hold:

| Key | What it does |
| --- | --- |
| `description` | Shown beside the command in the `/` menu and the command palette. |
| `argument-hint` | Shown in the menu so you know what to type after the name. |
| `arguments` | Names for the arguments, so the text can say `$number` instead of `$0`. |
| `send` | `auto` (the default) sends the expansion. `review` puts it in the message box for you to edit first. |
| `mode` | The mode a conversation starts in when this command is its first message, such as `plan`. |
| `workspace` | `local` or `worktree`, applied when this command starts a conversation. |
| `profile` | Recorded with the turn for agent profiles. |

## Arguments

| In the text | Becomes |
| --- | --- |
| `$ARGUMENTS` | Everything you typed after the name. |
| `$0`, `$1`, … | One argument each, counting from zero. Quotes group words: `/fix "the login page"`. |
| `$number` | The argument in that position of `arguments`. |
| `${CAPSULE_PROJECT_DIR}` | The conversation's folder. |

If the text uses none of these and you typed arguments, Capsule adds them at
the end on a line starting `ARGUMENTS:`.

## Shell output

Text written as `` !`command` `` is replaced by what that command prints. It
runs on the desktop, in the conversation's folder, before the agent sees
anything:

- It has 10 seconds. A command still running then is stopped, and what it
  printed so far is kept with a note.
- Output and errors together are kept up to 16 KB.
- If it exits with an error, its output is kept with `(exit N)` after it.

Arguments placed inside a command are quoted, so whatever you type after the
name is passed as text and cannot start another command.

## Files

`@path` in a command attaches that file to the message, the same way choosing
a file after `@` in the message box does. Paths are read from the
conversation's folder. A path that leads outside it is not attached, and the
Run log says so. A message holds at most eight files.

## Commands from a project

A project's commands come from whoever wrote the project. Their text is used
right away, but their `` !`command` `` lines wait until you trust the project
folder. Until then each one is replaced by
`(not run: trust this project to run shell in commands)`. Settings marks those
commands "shell waits for trust". Your own commands always run.

## When two commands share a name

A project command wins over yours of the same name, and yours win over those
from other tools' folders. Settings lists the one that is not used as a
problem, with its path. A command also wins over an agent's own command of the
same name, so name yours to avoid the agent's when you still want both.

## Other tools' folders

**Settings → Skills → Commands → Other tools' folders** can also read:

- Claude Code commands, from `~/.claude/commands` and each project's
  `.claude/commands`.
- Codex prompts, from `~/.codex/prompts`. In these files `$1` is the first
  argument, as those files expect.

They are read as Markdown only. Keys in them that Capsule does not use are
ignored, and file names are lowercased. Turning one on writes `commandSources`
to your own settings file; a project's settings cannot turn them on.

## From a phone or another browser

A paired device lists the same commands in its `/` menu. Sending `/name
arguments` from a device that can send messages expands the command on the
desktop, so `` !`command` `` output comes from the desktop's folder. A command
set to `send: review` is sent from a paired device without the editing step,
because expanding it for editing can run shell commands on the desktop.

## While a turn is running

A command typed while the agent is working waits in the queue and expands when
it is sent, even with follow-ups set to steer.
