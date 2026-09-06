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

If you have already typed or attached something new while sending, that new
draft stays untouched. The failed submission is saved in **Stash**, and a notice
tells you where to recover it.

Live work-log updates are grouped into short batches while completion appears
promptly. They do not reload the whole workspace on every event. Older messages
you have opened remain in the conversation after a reconnect, and overlapping
saved and live events are shown once.

Long runs keep a recent activity window so the conversation stays responsive.
**Recent activity** means the visible counts do not cover the whole run. Open
that turn’s **Run log** (or **What the agent reported** after failure) and use
**Older events** and **Newer events** to inspect recorded history. Oversized
diagnostic payloads are shortened and labelled; these logs are not a complete
copy of tool output. Agent replies remain separate from this diagnostic limit.

## Choose a model

Open the agent name in the composer to choose an agent or a model it reports.
The same control shows the current model when that model is known. Changing it
updates the session without posting a message or a status
banner, and leaves your draft untouched. This also applies to model changes in
Harnesses when the runtime supports it. Unavailable model choices explain why
they cannot be selected; Capsule does not invent a model list. Direct sessions
cannot change models or permissions while running. Their permissions control
shows **Agent-managed** and explains the approval limits when opened.
To inspect the session's raw status, open **Harnesses**, select the
session with **Refresh**, and expand **Session diagnostics**. Diagnostics stay
with that session and are collapsed by default.

Switching to a different harness starts it with its own default model. A model
override from the previous harness is not carried across.

The info control beside the paperclip explains the selected harness and runtime
route's model, permission, steering and browser support. The same information
is available in Harnesses, and Browser describes its agent-tool limitations.
Manual browsing is separate from an agent's ability to control that browser.

The workspace strip below the prompt holds the folder, terminal, checkout mode
and branch. For Git folders, **Current checkout** or **Worktree** also offers
**Change folder**. In compact panes the workspace and branch labels become icons;
their names remain in tooltips and menus. The **…** menu holds permissions, conversation mode,
prompt stash and the link to Harnesses. The agent picker and send button stay
reachable. Menus support arrow keys, Home, End and Escape; closing one returns
focus to its trigger.

## Read activity accurately

Expand the activity row to see its steps, **Run log** and **Verification** in
one place. Collapsing it preserves your check inputs and current log page.

**Sending** means Capsule is submitting the prompt, not that the agent is
already running. **Stopping** means a cancellation request is pending; a failed
stop returns to the reported run state and shows its error. **Completed** does
not mean verified: **Verified** requires a passing recorded check for that run.
Failed, cancelled, blocked and stale-check states remain distinct. Expand the
run log for diagnostics rather than reading raw status messages as agent replies.

When the selected route needs an offline Gateway, one connection row appears
inside the composer. Use **Connect**, or **Retry connection** after an error;
you can still prepare a draft. Direct agents do not require this connection.
Missing-login and installation guidance remain separate from connection recovery.

## Attach local files

Type `@` or choose **Add context → Project files** to search the current
conversation’s folder. Results show the file name and parent path. Enter or Tab
attaches the selected file without sending your draft; Escape closes the picker.
File paths with spaces are preserved. Search failures and empty results are
labelled, and an older search cannot replace a newer result. Files selected here
use the same validation and removable chips as the paperclip.

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
the stash list and puts its text, attachments and selected skill back in the composer.

## Thread agents

Open **Agents** from the inspector’s launcher or **Show thread agents** in the
command palette. It shows the primary agent for this thread’s latest turn and
any structured delegated tasks reported by the runtime, in stable order.

This is not a complete roster of the agent’s internal subagents. Some harnesses
and Gateway versions do not report delegation details or task token usage.
Unknown values stay labelled **Not reported**. A completed delegation tool does
not prove a background child agent has finished, and ending the parent turn
does not mark every child complete. Task status is not verification.

The panel uses a bounded recent event window and labels partial history. It
does not start agents or control child sessions. **Manage harnesses** opens the
harness manager; **Side chat** remains a separate surface.
