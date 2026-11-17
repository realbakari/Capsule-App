# Checking a turn

A completed reply means the agent finished responding, not that tests passed.
Expand a completed turn's activity row, then **Verification**, to see its
recorded checks. **Verification** shows once the project has a saved check or
the turn has a result; a project with neither shows nothing. The activity row
keeps the result visible while collapsed, including when a turn has not been
verified.

To run a check:

1. Save a test or build command under **Actions** in the project header. Once
   one exists, a turn's **Verification** details offer **Add check** for more.
   Saving a check does not execute it.
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

**Check output** contains the exact command, exit code, time, and the last
20,000 characters of output. **How this is checked** says where the check ran. It stays with its turn after
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

Activity and verification share one expandable card; older cards stay with
their original turn. Collapsing it preserves check inputs. Tool counts describe distinct calls where the agent supplies
call identifiers, not every status update. A finished work log is not proof
that checks passed. If no reply was received, the turn says so rather than
presenting tool activity as an answer.
