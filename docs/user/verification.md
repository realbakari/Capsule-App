# Checking a turn

A completed reply means the agent finished responding, not that tests passed.
Open **Verification** beneath a completed turn, or in run history, to see its
recorded checks. The details start collapsed.

To run a check:

1. Open the turn’s **Verification** details. Use **Add check** to save a test or
   build command, or choose an action already saved with **Add action** in the
   project header. Saving a check does not execute it.
2. Choose the saved check. If the project has only one action, it is selected
   for you but never run automatically.
3. Review the displayed command, then select **Run selected check**.

Only run commands you trust: an action can change files. Checks run on this Mac
in the folder recorded for the turn, even if you later select another project
or change the project folder. They never certify files on a remote agent host.
Strict sandbox mode disables shell checks; read-only paired devices cannot
start or cancel them.

## Reading the result

| Result | Meaning |
| --- | --- |
| Not verified | There is no matching completed check, or a human must review the requirement. An agent saying “tests passed” is not evidence. |
| Checks passed | The selected command exited successfully and the saved workspace revision matched before and after it ran. This is not a guarantee of overall correctness. |
| Check failed | A recorded command or objective requirement failed. The reply remains completed. |
| Out of date | The files or Git revision changed, or the final workspace snapshot could not be recorded. The result cannot verify this turn. |

**Check output** and **Evidence details** contain the exact command, exit code, timestamps, workspace
revision, and the last 20,000 characters of output. It stays with its turn after
restart. A passing receipt describes that saved revision, not subsequent edits.
Once a receipt exists, use **Recheck evidence** to compare it with the current workspace without
executing a command again. A stale result does not change or restore files.

**Cancel check** stops a running check. Checks also time out after two minutes;
a cancelled or interrupted check never counts as a pass. Repeated clicks share
the same in-progress check. Wait for it to finish or cancel it before sending
another turn into that folder.

An older turn without a saved workspace revision, or a folder without Git,
remains unverified. Ignored files, installed dependencies, external services,
and changes made and then reverted while a check runs are not covered by the
snapshot comparison. Choose checks appropriate to the work and review their
output before relying on them.

The newest receipt appears after the work log; older receipts stay with their
original turn. Tool counts describe distinct calls where the agent supplies
call identifiers, not every status update. A finished work log is not proof
that checks passed. If no reply was received, the turn says so rather than
presenting tool activity as an answer.
