# Restoring, redoing and forking turns

Capsule briefly retries temporary Git lock contention while recording a turn.
It does not remove another process's lock or alter your staging area. If the
lock remains busy, recording fails visibly; a retry is not proof that a
checkpoint was saved.

Every turn that finishes captures the state of your project folder. That
capture is the turn's checkpoint, and it is what you go back to.

## Restoring a turn

Hover a prompt or a reply and open its turn menu (the branch icon), or choose
**Restore this turn…** on the changed-files card. You pick what to restore:

- **Files** puts the project folder back to how that turn left it. Every
  message stays. This also undoes anything you changed by hand since.
- **Conversation** hides every turn after this one. Files stay exactly as they
  are. The agent starts a fresh session on your next message and is given the
  turns you kept, so it knows what came before without remembering what you
  hid.
- **Both** does the two together.

A choice that cannot apply says why: a turn without a checkpoint cannot
restore files, and the latest turn has nothing after it to hide.

**Compare** shows what restoring the files would change before you commit to
it: the folder as it is now against the turn's checkpoint, file by file, in the
same diff view as a turn's changes. If the folder already matches, Compare
says so.

When two conversations share one folder, restoring an older turn would also
undo whatever the other conversation did since. Capsule refuses that restore
and names the conversation that changed the folder; restore from that
conversation instead, or give each conversation its own worktree.

## Redo

Right after a restore, a banner says what changed and offers **Redo**. Redo
puts back exactly what the last restore took: the folder as it stood, the
hidden turns with their changed-files cards, and, where the agent can resume
it, the agent session it had. **Redo last restore** in the command palette does
the same after you dismiss the banner.

Redo lasts until something new happens in the conversation. Once you send
another message, the hidden turns and the saved folder state are discarded and
Redo is gone. Restoring twice in a row can be redone twice, newest first.

## Forking a conversation

Choose **Fork from here** in a turn's menu to start a new conversation that
shares this one's history up to and including that turn. The original is not
changed. The fork is named after the original with "(fork)" and opens right
away. Its first message starts a fresh agent session that is given the copied
turns as context, on the same kind of connection and with the same agent
settings as the original.

**Fork into a new worktree** does the same in a new Git worktree whose files
match that turn's checkpoint, so the two conversations can change files
without stepping on each other. Without one, both conversations work in the
same folder.

**Fork conversation from last turn** in the command palette forks at the
latest finished turn.

Under the turn where conversations part, a branch row shows which branch you
are reading, such as **Branch 2 of 3**. The arrows step to the previous or next
branch, and the row opens a list that names each branch, when it was forked,
whether it has its own worktree, and how far it has got since. The original is
always first, and a fork offers **Back to original**. The row works from the
keyboard: Tab to it, Enter opens the list, the arrow keys move, Enter opens a
branch and Escape closes the list.

## Editing from here

Hover one of your own prompts and choose **Edit from here** to try it again
differently. The prompt and every reply after it leave the conversation, the
prompt comes back into the composer with its attachments, and earlier turns
stay. The agent starts a fresh session on the next turn that is given the turns
you kept, not the ones removed. The conversation keeps its agent settings, such
as model, reasoning effort, permissions and mode, and how it connects to the
agent.
**Edit and restore files** does the same and also puts the project folder
back to how the turn before stood, using that turn's checkpoint. If no earlier
turn has a checkpoint, Capsule says so and changes nothing. Edit from here is a
restore too, so Redo brings the removed turns back until you send again.

Restores, Redo and forks wait for a running turn to stop, and are available in
the desktop app only. A paired device that reads the workspace does not show
them.

## Reading a turn's changes

The card stays beneath that turn's reply when you send a follow-up. Folding
the old turn folds its card too; expanding the turn brings it back. It does not
follow you into another conversation or project.

Hover a changed file, or focus its row with the keyboard, to preview its saved
diff without leaving the conversation. The preview shows line numbers, syntax
colouring, and additions and removals. Move the pointer into it to scroll;
press Escape to dismiss it. With the file row focused, Down Arrow moves into
the preview's **Open file diff** control.
Moving between the file row and its open preview keeps the code loaded. Scrolling
another panel does not close it; scrolling the conversation dismisses the hover
preview so it cannot become detached from its file.
Each file opens at the start of its saved diff. Line numbers stay visible when
you scroll sideways, and returning to the same open preview keeps your place.
Diff previews use a compact layout and the same readable code colours in both
themes, with subtle full-width backgrounds for additions and removals.

Select a file row (including on touch devices) to open that file's saved diff
in place. Select **All changed files**, or the card's heading, for the entire
turn. Large hover previews are labelled **Excerpt**. File previews are limited
to 512 KB; for larger files, inspect the saved checkpoints in Git for the complete
change. Binary files and changes without a text diff are identified instead
of showing a blank code panel.
These previews retain their file names even when your Git preferences hide or
customize diff prefixes. Your Git configuration is not changed.

Later edits do not change these saved views. The Review panel still shows your
current repository changes; use it to stage or discard current edits. Hovering
never changes files or restores a turn. On the latest turn, a hunk that still
matches your files can be rejected from the open diff; see
[Reviewing changes](./review.md).

If a saved diff cannot be read, the turn shows an error with **Retry** instead
of looking unchanged. A missing base snapshot is never replaced with your live
files. Large saved diffs have file and row pages so expanding them stays bounded.
The file list loads separately from the patch. A large patch does not hide the
list, and selecting a file loads just its saved changes. Very large lists show
up to 2,000 files and explicitly label incomplete lists or totals.

When both saved snapshots exist, an empty diff means no changed-files card.
If a before-snapshot is unavailable (including the first saved turn), Capsule
can list writes reported by that turn, but does not substitute your current
repository changes or invent a saved diff.

Without a saved diff, a long run may show only recent reported file activity.
That limitation is labelled, and earlier recorded activity remains in the run
log. It is not a claim to list every file changed in the run.

Restoring files replaces everything changed since that point, by the agent
and by you, so Capsule asks first and keeps a copy for Redo. Stop agents, checks, actions and terminal panes in
that folder or overlapping project folders before restoring; Capsule refuses
while its own work is active.
External editors and commands are outside this guard: stop those too.

## What it does to your repository

Checkpoints keep the worktree separate from your staging area and branch history:

- **Your staged changes are left alone.** A checkpoint is captured through a
  throwaway index, and restoration uses a private index too. Staged contents
  survive both operations. Restoring may leave staged content different from
  the restored files; review before committing.
- **No branch, tag, or commit appears in your history.** Checkpoints are stored
  outside the branches and tags git shows you, so `git log`, `git branch` and
  your git client look exactly as they did.
- **Normal pushes exclude checkpoints.** They stay local unless you explicitly
  copy or push their hidden refs using other Git tools.
- **Deleting a conversation deletes its checkpoints.** A checkpoint holds every
  file in the folder that git does not ignore, untracked ones included, so
  checkpoints are removed with the conversation (or project) they belong to
  and git can reclaim the space. The copy Redo keeps goes the same way, and
  sooner: with your next message. A fork keeps its own copies of the
  checkpoints it shares, so deleting the original leaves the fork's changes
  readable.

Projects that are not git repositories do not get checkpoints, and the restore
control does not appear for them.

Captures run in the background without freezing the app. A follow-up into the
same folder waits for its pending capture. New turns retain their original
folder and revision, so later project changes do not move their saved outcomes.
See [Checking a turn](verification.md) for explicit test and build receipts.
