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

## Tags

Tags are your own labels on conversations, across projects.

- **Add tags** from a conversation's menu (**Tags…**) in the sidebar or the
  titlebar, or in the **Tags** field of Conversation details. Type a tag and press
  Enter or a comma. Tags you already use are suggested. Backspace in an empty
  field removes the last tag, and each chip has its own remove button.
- Tags are stored in one spelling: lowercase, without a leading `#`, with spaces
  turned into dashes. "Bug Fix" and "#bug-fix" are the same tag. A conversation
  can have up to 12.
- **By tag** in **Group conversations** lists one group per tag, alphabetically,
  across every project, then the conversations with no tag. A conversation with
  two tags appears under both.
- **Search by tag.** Type `#name` or `tag:name` in the sidebar search or the
  command palette to keep only conversations with that tag. Combine it with text
  (`login #bug`) or with more tags, which must all match.
- **Rename or delete a tag everywhere** in Settings, General, Tags. Renaming onto
  a tag that already exists merges the two. Deleting removes the tag from every
  conversation; the conversations stay.

On a paired device that only reads, tags are shown but cannot be changed.

## Temporary conversations

A temporary conversation is for a quick question or a throwaway experiment you do
not want in your list for good. Start one with **New temporary conversation** in
the command palette, or from the arrow beside **New conversation** at the top of
the sidebar.

- It is never saved. Its messages and turns are held in memory and are gone when
  Capsule quits.
- It is marked **Temporary** in the sidebar, and a strip above the composer says
  so.
- It always works in the project's own checkout, never in a worktree, and it
  records no checkpoints, so it leaves nothing in your repository. Restoring or
  forking a turn needs those, so keep the conversation first.
- The agent runs as usual. Its own session is not kept by Capsule once the
  conversation is gone.

**Keep this conversation** (in the strip, the conversation's menu, or the palette)
saves it, with its messages, turns and tags, and from then on it is an ordinary
conversation. Deleting a temporary conversation removes it at once.

## Start a conversation from a GitHub issue

Choose **New conversation from a GitHub issue…** in the command palette, or
**From a GitHub issue…** from the arrow beside **New conversation**. Capsule lists
the open issues of the current project's GitHub repository. Search by number,
title or label, then press Enter.

The new conversation:

- works in its own worktree, on a branch named after the issue, such as
  `issue-123-short-title` (after your branch prefix). If that branch already
  exists, the new one gets a short suffix;
- is titled with the issue number and title;
- has the issue's link, title and description in the composer, ready to edit
  and send. The issue's text is marked as coming from GitHub, so the agent treats
  it as the task's description rather than as your instructions.

The list comes from the GitHub command-line tool (`gh`). If it is not installed,
not signed in, or the project has no GitHub remote, the picker says which, and
**Retry** checks again after you fix it. Picking an issue is available on this
computer only, not on a paired device.
