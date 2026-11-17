# Reviewing changes

The **Review** panel shows what changed in the conversation's folder and lets
you take or throw away each change separately. Open it from the panel's icon
bar, with `⇧⌘D`, or from the command palette.

## Choosing what to compare

The menu at the top of Review picks the comparison. Capsule remembers the kind
of comparison for each project.

| Scope | Shows | You can |
|-------|-------|---------|
| **Uncommitted** (the default) | Everything not yet committed, staged or not | Keep, Unstage, Reject |
| **Staged** | Only what is staged for the next commit | Unstage |
| **Unstaged** | Only what is not staged yet, new files included | Keep, Reject |
| **Turn N** | What one turn of this conversation changed | Read only |
| **Branch** | Everything since this branch left the base you compare against, plus what is not committed yet | Read only |
| **Commit** | What one commit on this branch changed | Read only |

**Branch** compares against the remote's default branch, or a local `main` or
`master`, until you pick another base. With Branch or a commit chosen, an
**against** menu beside the scope lists your local branches and the remote
ones; the base you pick is remembered for the project on this device. If it
is later deleted, Review goes back to the default branch. In a worktree
conversation the default is the whole conversation's work.

Under **Commits since** the base, the menu lists the branch's own commits,
newest first, by subject and short ID (the latest hundred). Choosing one shows
just what that commit changed, against its parent. A file moved without Git's
help, by an agent or in Finder, shows as one renamed file rather than a
deleted file and a new one, in every scope.

The menu lists every turn of the conversation that saved a checkpoint, newest
first, as **Turn N** with the start of its prompt. Turns from either runtime
route appear once they have a checkpoint; a turn in a folder that is not a git
repository has none. The turn you pick is remembered for the conversation until
you quit; otherwise Review shows the newest turn. A turn's view hides staging,
discard and commit, and **Back to uncommitted changes** returns. The first
checkpointed turn of a conversation has nothing earlier to compare against,
and Review says so instead of guessing.

With no file selected, the diff covers every changed file. Select a file in the
changed-files list to see just that file; **All files** goes back. Each row in
that list shows the lines added and removed and a status letter: **M**
modified, **A** added, **D** deleted, **R** renamed, **U** untracked (new and
not added to Git yet), **!** conflicted. Point at the letter to see whether the
change is staged.

Above the diff, Review totals what the scope changed, such as "4 files +120
−18". **Hide tests** appears when some changed files look like tests (such as
`app.test.ts`, `tests/…`, `user_spec.rb`) and hides them until you switch it
off, saying how many are hidden.

A file header shows **Copy path** and **Open in editor** when you point at it
or tab to it. **Open in editor** uses your favourite app from **Open in**, or
the system default. A binary file is marked **Binary** instead of line counts.

A very large change still shows. Review reads up to 16 MB of diff and up to 200
new files at once, smallest first; a new file over 1 MB is not read. Everything
else is listed under **N files not shown**, each with why: **Too large to
show** files open in your editor, and files **Over the limit for one read**
have **Show**, which reads that file on its own. A long list shows its first
twenty and how many more there are. **Unified** shows each file in one column and **Split** side by side;
**Wrap** wraps long lines to the panel instead of scrolling them sideways.
**Settings › Source control › Diff layout** picks the starting layout. Side by
side needs room, so a narrow panel starts in one column until you choose
**Split** or widen the panel. If the diff cannot be read, Review says why in a
sentence and offers **Try again**.

**Ignore whitespace** hides changes that only touch spaces, tabs or line
endings. **Settings › Source control** sets whether Review starts with it on;
switching it in Review changes it for that conversation until you quit. While
whitespace is hidden the diff is not the exact patch Git would apply, so Keep,
Unstage and Reject are off until you switch it back.

**Collapse all** and **Expand all** fold or open the files on the current page.
Tick **Viewed** on a file to fold it and count it in "3 of 8 viewed". The mark
belongs to that version of the file's changes: when the file changes again, it
reads as not viewed. Marks are kept on this device only, per conversation.

The command palette has an entry for each scope, such as **Review staged
changes**. Choosing one switches the scope and opens Review; **Review this
turn's changes** opens the newest turn.

## Keep, Unstage and Reject

Each hunk has its own buttons:

- **Keep** stages that hunk and nothing else in the file.
- **Unstage** takes that hunk back out of the next commit. The file is not
  touched.
- **Reject** puts that part of the file back as it was in the last commit. In
  **Uncommitted**, a staged hunk is removed from the staged changes too.

In **Uncommitted**, a hunk that is already staged says **Staged** and offers
**Unstage** instead of **Keep**. A hunk that is only partly staged says
**Partly staged**; **Keep** stages the rest.

A file with more than one hunk also has **Keep all**, **Unstage all** and
**Reject all**. Rejecting every hunk of a file asks first.

A new file that Git does not track yet is a single hunk. **Keep** stages it.
**Reject** deletes it after asking, because Git has no copy to bring back.

After an action, the diff refreshes in place and keeps your position. If the
file changed underneath and the hunk no longer matches, nothing is changed: the
hunk shows Git's reason, with **Reload diff** to read the file again.

Binary files have no hunks. Use the stage and discard buttons in the
changed-files list for those.

A file you moved without Git (renamed in Finder, or by an agent) is one
renamed file. **Keep** on any of its hunks stages the move together with that
hunk. A move with no edits has **Keep all**, which stages just the move, and in
**Staged** an **Unstage all** that puts it back. **Reject** undoes the edits
and leaves the file where it now is. Review reads new files from a private
copy of Git's index, so opening it never stages anything.

## Notes for the agent

Point at a line of any diff in Review and press
the **+** beside its number to leave a note on it. ⌘Return adds the note and
Escape cancels. Notes stay on their lines, each with **Edit** and **Remove**,
and the bar above the diff counts them. Open the count to see them all.

**Add to message** puts every note into the message you are writing, as one
block that starts "Review comments:" with a `path:line` and the note on each
line, and clears them from Review. Nothing is sent until you send the message,
so you can still edit it in the composer. **Discard** drops the notes. Notes
last for this conversation until you quit.

## From the keyboard

Press `Tab` to reach a hunk's heading, then:

| Key | Action |
|-----|--------|
| `j` or `↓` | Next hunk |
| `↑` | Previous hunk |
| `k` | Keep |
| `u` | Unstage |
| `x` | Reject |

A key does nothing where its action is not offered.

## Rejecting part of the latest turn

The changed-files card under a turn opens that turn's saved diff. On the
conversation's latest turn, each hunk that still matches your files has a
**Reject** button, which reverts just that hunk. A hunk you have edited since,
or a hunk from an earlier turn, has no button; use Review for those.

## Committing, pushing and pulling

Commit from the box under Review's file list, or from **Commit & push** in
**Conversation details**. Both commit what you chose and nothing else:

- **When something is staged**, the button says so, such as **Commit 3
  staged**, and only the staged changes go in. Unstaged edits and new files
  stay in the working tree.
- **When nothing is staged**, Review's button commits every changed file and
  says how many. Stage files first to commit only those. The
  **Commit & push** menu lists the changed files instead, every one ticked,
  with new files under **Untracked**; untick the ones to leave out.

The message box takes more than one line. The first line is the commit's
subject and the rest is its body. ⌘Return commits.

A commit or push can run your repository's hooks, which may take minutes. The
menu says **Running commit hooks…** while they do, and Capsule waits up to ten
minutes. If a hook stops the commit, its output is shown under the buttons and
your message is kept. Files Capsule staged for that commit are unstaged again,
so the next try picks up your fix.

**Push** sends your commits to the branch's remote. A branch that has never
been pushed shows **Publish branch** instead, which pushes it and makes it
track the remote branch. The remote is the one the branch is set to push to,
or the repository's default push remote, or its only remote.

On the repository's default branch, such as `main`, pushing asks first. You
can push there anyway, or put the work on a new branch named from your commit
message (under your branch prefix) and push that. **Create pull request** on
the default branch always moves the work to a new branch first, since a pull
request needs a branch of its own. The pull request's description lists the
branch's commits.

Capsule fetches from the remote now and then in the background, and when you
open the menu, so it knows when the remote has moved on. A failed fetch is
silent and never asks for a password. When the remote has commits you lack:

- **Pull** brings them in when your branch has nothing new of its own. Push
  waits until you have pulled, and says why.
- When both sides have new commits, the menu says how many each has and offers
  **Rebase onto** the remote branch, which replays your commits on top. If that
  meets a conflict, Capsule stops and leaves your branch as it was; resolve it
  in the terminal.

## On another device

A paired viewer can read every scope but cannot Keep, Unstage or Reject,
leave notes, open files in an editor, and cannot commit, push, pull or switch
branches. Those buttons appear only on the
computer running Capsule.

## When Git status cannot be read

Capsule checks the folder's Git status in the background, when you come back
to the window and after a turn. If that fails, nothing appears in the
conversation: the list icon in the title bar gets a dot, and **Conversation
details** shows the reason under **Changes**. The last status Capsule read
stays on screen until a new one arrives.

A folder in iCloud Drive with **Optimize Mac Storage** turned on can have files
that are only in iCloud. Capsule lists changes without downloading them, and
leaves out line counts while changed files are not downloaded. If the
repository's own Git data is not downloaded either, the reason says so. In
Finder, Control-click the folder and choose **Download Now**, or keep your
projects in a folder that is not synced.
