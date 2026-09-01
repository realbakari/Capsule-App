# Restoring a turn

Every turn that finishes captures the state of your project folder. When a turn
changes files, the changed-files card under the reply offers **Restore this
turn**, which puts the folder back to how that turn left it.

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
