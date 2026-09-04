# Restoring a turn

Every turn that finishes captures the state of your project folder. When a turn
changes files, the changed-files card under the reply offers **Restore this
turn**, which puts the folder back to how that turn left it.

The card stays beneath that turn's reply when you send a follow-up. Folding
the old turn folds its card too; expanding the turn brings it back. It does not
follow you into another conversation or project.

Select the card to expand that turn's saved diff in place. Later edits do not
change this saved view. The Review panel still shows your current repository
changes; use it to stage or discard current edits.

When both saved snapshots exist, an empty diff means no changed-files card.
If a before-snapshot is unavailable (including the first saved turn), Capsule
can list writes reported by that turn, but does not substitute your current
repository changes or invent a saved diff.

Restoring discards everything changed since that point — by the agent *and* by
you — so Capsule asks first.

## What it does to your repository

Nothing you will trip over later:

- **Your staged changes are left alone.** A checkpoint is captured through a
  throwaway index, so a half-staged change you were in the middle of survives.
- **No branch, tag, or commit appears in your history.** Checkpoints are stored
  outside the branches and tags git shows you, so `git log`, `git branch` and
  your git client look exactly as they did.
- **Nothing is pushed.** Checkpoints are local to your machine.

Projects that are not git repositories do not get checkpoints, and the restore
control does not appear for them.

Captures run in the background without freezing the app. A follow-up into the
same folder waits for its pending capture. New turns retain their original
folder and revision, so later project changes do not move their saved outcomes.
See [Checking a turn](verification.md) for explicit test and build receipts.
