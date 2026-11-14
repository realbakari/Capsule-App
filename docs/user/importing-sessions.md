# Importing sessions from Claude Code and Codex

Work you started in a terminal does not have to stay there. Capsule reads the
session history Claude Code and Codex keep on this computer and lists the
sessions that ran in a project's folder. Importing one creates a thread whose
transcript is that session's prompts and final replies.

## Finding sessions

There are three ways in:

- The project's menu in the sidebar: **Import sessions…**.
- The command palette: **Import sessions from Claude Code or Codex…**.
- An empty conversation in a project with sessions waiting says so, for
  example "Found 12 Claude Code sessions in this folder. Import…".

The dialog lists the newest sessions first, each with its title or first
prompt, the agent, how many turns it has and when it was last active. Filter
by agent with the chips above the list. A session you already imported shows
**Open** instead of **Import**, and opens the thread you made the first time.

Sessions are matched to the project's folder. A project without a folder has
nothing to match, so attach one first.

## What happens to your next message

An imported thread is marked at the top with where it came from and what your
next message does:

- **Resumes the agent's own session.** On direct mode, Capsule reopens the
  Claude Code or Codex session by its id. The agent has everything it
  remembered, including tool results the transcript does not show.
- **Read-only history.** Through the OpenClaw Gateway, the Gateway runs its own
  agent sessions and cannot reopen one started on this computer. Your next
  message starts a fresh agent session that is given the transcript as
  context, once.

The dialog says which applies before you import.

## What is copied

Only prompts you typed and the reply that ended each turn. Tool calls, tool
output, reasoning, slash commands and subagent work stay in the agent's own
history. Capsule only reads those files; it never changes or deletes them.

## Other agents

Other agents keep no documented session history on disk, so their sessions
cannot be imported yet.
