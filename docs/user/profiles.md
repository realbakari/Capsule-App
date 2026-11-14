# Profiles

A profile starts a conversation with an agent, a model, an effort, a
permission, a workspace and standing instructions, in one pick. "Reviewer"
might be Codex at high effort, supervised, in concise style. "Fast fixer"
might be Claude Code with full access in its own worktree.

## Starting from a profile

- In the composer, open the agent menu and choose **…** (All agents).
  Profiles are listed above the agents.
- In the command palette (⌘K), choose **New conversation with** a profile.
- In Settings → Agents → Profiles, choose **Start**.
- Bind a key to `profile:reviewer` in `keybindings.json`.
- Give a command `profile: reviewer` in its frontmatter. When that command
  starts a conversation, the profile applies first.
- From a paired device with conversation control, start a thread from a
  profile. It stays supervised and in the project's checkout, whatever the
  profile asks for.

The conversation's title bar shows which profile started it.

## Writing a profile

A profile is a Markdown file in `~/.capsule/profiles/`, or in a project's
`.capsule/profiles/` to share it with the team. A project's profile wins
over yours of the same name. **New profile** in Settings writes one from a
template and opens it; **Duplicate** copies one.

```markdown
---
name: Reviewer
description: Reads before it writes, risks first
harness: codex
model: gpt-5.5
effort: high
permission: strict
mode: plan
workspace: worktree
style: concise
skills: [security-review]
mcp: [docs]
color: "#4A7A5C"
---
Lead with risks, then style.
```

| Key | What it does |
| --- | --- |
| `name`, `description` | How the profile is listed. |
| `harness` | The agent: a coding agent such as `codex` or `claude`, or one of Capsule's own. |
| `model` | The model to start the agent with. It must be one the agent reports. |
| `effort` | The agent's own effort value, such as `high`. |
| `permission` | `strict` (Supervised), `default` (Standard) or `approve-all` (Full access). |
| `mode` | For Capsule's own agents, the conversation mode. For a coding agent, a mode such as `plan` is set through the agent's own controls when it has one. |
| `workspace` | `local` or `worktree`. |
| `style` | A [response style](./settings-files.md#response-style-and-personal-instructions), instead of your default. |
| `skills` | Installed skills whose instructions join the first message. |
| `mcp` | Only these [MCP servers](./settings-files.md#mcp-servers). Leave it out for every enabled server; `[]` offers none. |
| `color` | The dot shown beside the profile's name. |

The text below the frontmatter is sent once, before your first message,
together with your response style and personal instructions. It is labelled
as standing instructions, never shown as your words, and it is advice the
agent reads rather than a rule Capsule enforces.

## What each route carries

The agent, model, permission and workspace apply on either route. Effort and
a coding agent's own mode are set on direct conversations, where the agent
reports those controls; a Gateway thread has neither, and the turn's
activity says that it was not applied. A profile's MCP servers reach direct
conversations only.

If a profile names an agent that is not installed, Capsule shows the same
setup prompt as picking that agent yourself. A profile file with a mistake
is listed in Settings with the line, and the rest of the file still applies.
