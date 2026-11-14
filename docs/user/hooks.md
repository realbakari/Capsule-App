# Hooks

A hook is a command Capsule runs at a moment in a conversation: when you send
a prompt, when an agent asks permission, when a tool finishes, or when a turn
ends. Capsule runs hooks itself, so the same hook works with every agent,
whether the conversation runs through the Gateway or directly, and whether
the message came from the desktop or a paired phone.

Hooks live under `"hooks"` in a settings file. **Open hooks settings** in the
command palette opens your user settings file.

```jsonc
{
  "hooks": {
    "PromptSubmit": [
      { "hooks": [{ "type": "command", "command": "sh ~/.capsule/hooks/no-secrets.sh" }] }
    ],
    "TurnEnd": [
      { "hooks": [{ "type": "command", "command": "pnpm format", "timeout": 60 }] }
    ]
  }
}
```

## Events

| Event | When | What a hook can do |
| --- | --- | --- |
| `PromptSubmit` | Before Capsule sends your message | Block it, or add context the agent receives with it |
| `PermissionRequest` | An agent asks to run, edit or fetch something, and no permission rule answered | Allow it, deny it, or ask you with a reason |
| `ToolCall` | A tool the agent ran has finished | Observe it. A hook cannot stop a tool the agent already ran |
| `TurnEnd` | A turn completes, fails or is blocked | Queue a follow-up message |

`TurnEnd` does not run when you stop a turn: a follow-up would overrule you.
It runs once per turn, whether the answer reached the conversation as a reply
or as the turn's result.

To stop a tool before it runs, use a `PermissionRequest` hook or a
[permission rule](./settings-files.md#permission-rules). That works only when
the agent asks first, which depends on its permission mode.

## What a hook receives

A command hook gets one line of JSON on standard input and runs in the
conversation's folder, with `CAPSULE_PROJECT_DIR` set to the project folder.

```json
{
  "event": "PermissionRequest",
  "thread_id": "sess_…",
  "project_dir": "/Users/you/code/app",
  "cwd": "/Users/you/code/app",
  "harness": "codex",
  "route": "direct",
  "permission": { "kind": "execute", "title": "Run tests", "command": "pnpm test", "paths": [] }
}
```

Each event adds its own field: `prompt` for `PromptSubmit`, `permission` for
`PermissionRequest`, `tool` (`kind`, `title`, `status`, `input`) for
`ToolCall`, and `run` (`status`, `result_excerpt`) for `TurnEnd`. `model` is
present when the conversation picked one.

## What a hook answers

- **Exit 0.** If standard output is JSON, Capsule reads it. Anything else is
  ignored.
- **Exit 2.** Blocks a prompt or denies a permission request. Standard error
  is the reason. For `ToolCall` and `TurnEnd` it is only logged.
- **Any other exit.** A failed hook. Capsule logs it and carries on.

The JSON a hook may print:

| Field | Event | Meaning |
| --- | --- | --- |
| `"decision": "block"`, `"reason"` | `PromptSubmit` | Do not send the message |
| `"additionalContext": "…"` | `PromptSubmit` | Text the agent receives after your message |
| `"decision": "allow"`, `"deny"` or `"ask"`, `"reason"` | `PermissionRequest` | Answer the request, or leave it to you |
| `"followUp": "…"` | `TurnEnd` | A message Capsule queues for the next turn |

`permissionDecision` is accepted in place of `decision` for
`PermissionRequest`.

A hook has 30 seconds unless it sets `"timeout"` in seconds, up to 120.
`ToolCall` hooks never hold up the turn: they run alongside it, a few at a
time.

## How the answers combine

Several hooks can run for one event. They run at the same time.

- For `PromptSubmit`, one block is enough. Otherwise every hook's context is
  added.
- For `PermissionRequest`, permission rules answer first. A hook sees only the
  requests no rule allowed or denied. Then deny wins over ask, and ask over
  allow, so one hook asking is enough for you to decide. An `ask` rule means
  the same: a hook can still deny such a request, but not allow it.
- An `ask` with a reason shows that reason on the approval card, with the
  hook's file, on the desktop and on a paired device.

## When a prompt is blocked

Capsule does not send the message, and does not keep it in the conversation.
A notice reads **Blocked by hook:** with the hook's reason and the file it
came from, and your message goes back into the composer so you can change it.
A paired device sees the same notice. A queued follow-up that a hook blocks
leaves the queue, and the queue shows the reason.

## Follow-ups from TurnEnd

A `TurnEnd` hook can keep a conversation going, so Capsule limits it: at most
three hook follow-ups in a row. After that, the next one is not queued until
you send a message yourself, and the turn's **Run log** says so.

## Matchers

For `ToolCall` and `PermissionRequest`, a group can have a `"matcher"` that
picks which tools it runs for. It is tested against the tool's kind
(`execute`, `edit`, `read`, `fetch` and so on) and its title.

- Names separated by `|`, such as `"edit|delete"`, match a kind or title
  exactly, ignoring case.
- Anything else is a regular expression, such as `"^Run "`.
- No matcher, or `"*"`, matches every tool.

## HTTP hooks

A hook can POST its JSON to a URL instead, and answer with the same JSON:

```jsonc
{ "type": "http", "url": "http://127.0.0.1:8787/hook", "headers": { "authorization": "Bearer …" } }
```

HTTP hooks are yours alone: Capsule ignores them in a project's files.

## Projects, trust and turning hooks off

Hooks in a project's `.capsule/settings.json` run only after you trust the
folder. Until then they are listed under what the project would run.

`"disableAllHooks": true` in any settings file turns every hook off,
including yours, and a project file can set it without being trusted. Safe
mode runs no hooks.

**Settings → Diagnostics → Customization** lists each hook in effect, the
file it is in, whether it is on, and how its last run went. **Recent runs**
below it shows each run's exit code and what it printed on standard error.

## Examples

### Block a prompt that holds a secret

`~/.capsule/hooks/no-secrets.sh`:

```sh
#!/bin/sh
input=$(cat)
if printf '%s' "$input" | grep -Eq '(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)'; then
  echo "This prompt holds what looks like a secret. Remove it and send again." >&2
  exit 2
fi
exit 0
```

```jsonc
"PromptSubmit": [{ "hooks": [{ "type": "command", "command": "sh ~/.capsule/hooks/no-secrets.sh" }] }]
```

### Format the code after every turn

```jsonc
"TurnEnd": [{ "hooks": [{ "type": "command", "command": "pnpm format", "timeout": 60 }] }]
```

Put it in the project's `.capsule/settings.json` so the whole team gets it.
It runs once the folder is trusted.

### Tell me when a turn ends

On macOS:

```jsonc
"TurnEnd": [{ "hooks": [{ "type": "command", "command": "osascript -e 'display notification \"A turn finished\" with title \"Capsule\"'" }] }]
```

Any script works the same way, such as one that posts to a team chat with
`curl`.

### Ask before a recursive delete or a force push

This gate never allows anything by itself. When an agent asks to run a
command that deletes recursively or force-pushes, it makes sure you decide,
even if another hook would have allowed it, and the approval card says why.

`~/.capsule/hooks/approval-gate.sh`:

```sh
#!/bin/sh
# Ask before recursive deletes and force pushes. Allows nothing by itself.
request=$(cat | tr -d '\n')
if printf '%s' "$request" | grep -Eq '"command":"[^"]*(rm +-[A-Za-z]*(rf|fr)|git +push[^"]* (--force|-f)( |"))'; then
  echo '{"decision": "ask", "reason": "This deletes recursively or force-pushes. Check it before it runs."}'
fi
exit 0
```

```jsonc
"PermissionRequest": [
  { "matcher": "execute", "hooks": [{ "type": "command", "command": "sh ~/.capsule/hooks/approval-gate.sh" }] }
]
```

Rules answer before hooks, so an allow rule such as `execute(git push *)`
would approve a force push before the gate sees it. Pair the gate with
`ask` rules, or keep your allow rules narrow.
