# Organizing conversations

The sidebar groups conversations by project, by status, or by recency (see
[Your first conversation](getting-started.md#organize-conversations)). This page
covers what each row can tell you and the ways to keep the list in order.

## Pull request state

A conversation that works in its own worktree shows a small pull request mark in
its sidebar row once Capsule has read a pull request for its branch:

- **Open** (green): the pull request is open.
- **Draft** (faint): the pull request is a draft.
- **Checks failing** (red): an open or draft pull request whose checks failed.
  This wins over Open and Draft, because it is the one that needs you.
- **Merged** (blue, merge icon) and **Closed** (faint).

Hover the mark for the number and state in words. The mark comes from readings
Capsule already makes: opening the conversation, and watching a pull request when
**Watch and fix** is on. Capsule does not ask GitHub for every conversation in
the list, so a mark can be as old as the last time you opened that conversation.
Conversations on the shared project checkout show no mark, because the pull
request belongs to the branch, not to the conversation.

## Pause and resume a worktree conversation

A conversation that works in its own worktree can be set aside. Choose **Pause**
from its menu in the sidebar or the titlebar, or **Pause conversation** in the
command palette.

Pausing:

- saves everything in the worktree (staged, unstaged and new files) to a hidden
  snapshot in the repository. Your branch gets no extra commit, and nothing on
  disk changes;
- stops the terminals Capsule opened in that worktree and the project actions
  (dev servers, previews) the conversation started. Nothing else is stopped;
- marks the conversation **Paused** in the sidebar. You cannot send to it until
  you resume.

Finish or stop a running turn before pausing. Pausing leaves the agent's own
session alone, so the conversation picks up where it was.

**Resume** (the same menus, or **Resume conversation** in the palette) checks the
worktree:

- If it is as you left it, nothing changes.
- If the paused work was lost (the files were reset or cleaned, or the folder was
  removed), the snapshot puts back the exact files and the exact staging area.
- If the worktree changed in other ways while paused, for example new commits or
  new edits, Capsule leaves it as it is and keeps the snapshot, so nothing you did
  is overwritten.

Project actions that pausing stopped are not restarted. Start them again from
Conversation details.
