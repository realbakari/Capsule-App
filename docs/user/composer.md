# Drafts, attachments, and prompt stash

Capsule keeps an unfinished draft for each conversation on this Mac. Switching
projects or conversations and returning later restores its prompt and selected
attachments. A successful send clears that draft.

If a send fails, your draft and attachments return to the composer. Once the
failed turn is recorded, its error appears once below the work log rather than
also appearing at the top. Dismiss hides that attempt's error; a later attempt
can still show its own failure. Sign-in guidance remains visible until dismissed.
Cancellation acknowledgements are controls, not replies, and do not appear as
agent messages. Previous records remain stored.

## Choose a model

When the running agent offers models, choose one beside its name in the
composer. Changing it updates the session without posting a message or a status
banner, and leaves your draft untouched. This also applies to model changes in
Harnesses when the runtime supports it. Direct sessions currently reject live
model/permission changes with an error and leave the saved selection unchanged.
To inspect the session's raw status, open **Harnesses**, select the
session with **Refresh**, and expand **Session diagnostics**. Diagnostics stay
with that session and are collapsed by default.

## Attach local files

Choose the paperclip or drop files onto the composer. Selected files appear as
removable chips before you send and as openable attachments in the timeline.
An attachment-only message is allowed.

Pasting files uses the same attachment validation as dropping them. Pasted
clipboard images are saved locally first. Attachments are desktop-only; a
paired read-only viewer cannot attach files or send messages.

Only one turn may run in a thread at a time. Wait or **Stop** before sending a
follow-up; Gateway sessions offer **Steer** during a live turn when supported.
Send-and-new-conversation stays put on a rejected send. A refresh failure after
an accepted send does not restore an already-sent draft.

Capsule validates the file again at send time and gives the agent its exact
local path. A missing file is refused instead of being silently omitted. Each
turn accepts up to eight files, with a 50 MB limit per file. The harness still
applies the conversation's permission mode when it reads those paths.

## Stash a prompt

Press `⌘S` while the composer contains text or attachments to move that draft
into the prompt stash. Choose the bookmark beside the paperclip to restore or
delete a stash. When the composer is empty, `⌘S` opens the stash instead.

The most recent 20 stashes are kept locally. Restoring a stash removes it from
the stash list and puts its text and attachments back in the composer.
