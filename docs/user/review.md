# Reviewing changes

The **Review** panel shows what changed in the conversation's folder and lets
you take or throw away each change separately. Open it from the panel's icon
bar, with `⇧⌘D`, or from the command palette.

## Choosing what to compare

The menu next to **Diff** picks the comparison. Capsule remembers your choice
for each project.

| Scope | Shows | You can |
|-------|-------|---------|
| **Uncommitted** (the default) | Everything not yet committed, staged or not | Keep, Unstage, Reject |
| **Staged** | Only what is staged for the next commit | Unstage |
| **Unstaged** | Only what is not staged yet, new files included | Keep, Reject |
| **This turn** | What the conversation's latest turn changed | Read only |
| **Branch** | Everything since this branch left the default branch, plus what is not committed yet | Read only |

**Branch** compares against the remote's default branch, or a local `main` or
`master`. In a worktree conversation that is the whole conversation's work.

With no file selected, the diff covers every changed file. Select a file in the
changed-files list to see just that file; **All files** goes back.

The command palette has an entry for each scope, such as **Review staged
changes**. Choosing one switches the scope and opens Review.

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

## On another device

A paired viewer can read every scope but cannot Keep, Unstage or Reject. Those
buttons appear only on the computer running Capsule.
