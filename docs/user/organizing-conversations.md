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
