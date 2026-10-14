# Drafts, attachments, and prompt stash

Scrolling up through a conversation rests the composer to a single prompt
line with attach and send on that same row, so the dock does not cover the
transcript. The workspace strip (folder, terminal, branch) stays under it.
Agent controls and steer tuck away. Scrolling back to the latest
messages restores the full composer. A multiline draft, attachments, an
open picker, a selected skill, or a file drop keeps it expanded. Focusing the field while
reading history does not grow it back.

Attachment and send controls stay beside the agent controls in the expanded
composer. The compact prompt keeps the checkout controls entirely below it.
The prompt and toolbar use consistent spacing as the pane narrows or text size
increases. Secondary settings move into named menus; text does not shrink to fit.
Task lists reflect the agent's latest plan, including a cleared plan. After a
turn ends, tasks it did not finish are labelled **Incomplete**, not **Running**.

Capsule keeps an unfinished draft for each conversation on this Mac. Switching
projects or conversations and returning later restores its prompt and selected
attachments. A successful send clears that draft.

If local storage cannot save a draft, Capsule keeps a bounded temporary copy
for switching conversations in this window. A warning asks you to copy it before
quitting. If that temporary space is full, copy the current edits before switching
conversations too; Capsule does not claim those edits were saved.

Screen-reader heading navigation can move from the conversation title to each
message's author, then through headings inside the reply. Steering messages and
attachment-only prompts have author headings too; these labels do not add visual
clutter or appear in copied message text.

Sent image attachments show a thumbnail in the conversation, including when
you reopen older messages. Select it to open the local file. Previews load only
near the visible conversation and are not a separate saved copy of the image.
If the source was removed, replaced with an unreadable file, or is too large,
the filename remains visible with **Image preview unavailable**. Other files
keep their compact name and size. Read-only paired viewers can see these
previews without getting write access.

Hover a message you sent for **Copy** and **Continue in a new conversation**,
which opens a fresh thread in the same project with that prompt ready to
edit and send. Tool activity in a reply folds into one line such as
"Ran 12 commands (1 failed)"; open it to see each step, and open a step to
see the command and its output.

If a send fails, your draft and attachments return to the composer. Once the
failed turn is recorded, its error appears once below the work log rather than
also appearing at the top. Dismiss hides that attempt's error; a later attempt
can still show its own failure. Sign-in guidance remains visible until dismissed.
Cancellation acknowledgements are controls, not replies, and do not appear as
agent messages. Previous records remain stored.

If you have already typed or attached something new while sending, that new
draft stays untouched, including while the first conversation is being created.
The failed submission goes to **Stash**, and a notice tells you where to recover
it. If local storage fails, the entry is labelled **Temporary · until app closes**;
copy or restore it before quitting. Capsule does not claim it was saved to disk.

Live work-log updates are grouped into short batches while completion appears
promptly. They do not reload the whole workspace on every event. Older messages
you have opened keep their associated run details after a reconnect, and
overlapping saved and live events are shown once.

Agent updates around tool steps stay as separate messages within the same turn,
so progress does not run into the final answer. Consecutive streamed text stays
intact, including words and code. This applies to new replies; previously saved
text is not rewritten to guess where missing breaks belonged.

Opening an existing conversation shows a loading placeholder until its history
arrives, not the new-conversation welcome screen. A failed history read offers
**Retry** and keeps any messages already on screen. Switching conversations
opens at the latest loaded messages; reading an older turn in one conversation
does not change that behavior in another.

Message and code copy buttons confirm **Copied** only after the clipboard accepts
the text. If copying fails, the button offers a retry. Copy controls appear on
hover or keyboard focus and remain visible on touch devices.

Replies support nested lists, read-only task lists, tables, quotes, and code
examples inside quotes. Wide tables scroll inside the message. Code uses
language-aware colors in dark and light themes, follows the conversation text
size, and wraps long lines. Unknown languages and very large code blocks remain
readable as plain text. Copying a code block copies its source, not its colors.
Completed code blocks and open review disclosures stay in place as more text
arrives. Unusually deep Markdown nesting is shown as readable source instead of
preventing the conversation from opening.

Named file links in replies open Files while keeping the agent's descriptive
label. Local file URLs and Windows drive paths are supported; the file must
still be inside the conversation's allowed workspace. Image links open a file
preview or web destination only when clicked, without loading remote images
automatically. Review links continue to resolve against their web page.

Paragraph spacing, list markers and medium-weight emphasis keep long replies
readable without changing your chosen conversation text size or rewriting
saved messages.

Long conversations keep a bounded display window: up to 300 messages and about
4 MB of text and attachment metadata. **Load older messages** moves through saved
history without loading the whole thread. Once newer messages fall outside that
window, **Return to latest** brings them back. Sending from an older window also
returns to the latest page. Very large messages show a labelled excerpt; the full
message remains in the local database. Only nearby turns are mounted on screen.

Long runs keep a recent activity window so the conversation stays responsive.
**Recent activity** means the visible counts do not cover the whole run. Open
that turn’s **Run log** (or **What the agent reported** after failure) and use
**Older events** and **Newer events** to inspect recorded history. Oversized
diagnostic payloads are shortened and labelled; these logs are not a complete
copy of tool output. Agent replies remain separate from this diagnostic limit.

## Model, effort, and permissions

Open the model control to search the selected agent's models or star favorites.
For local Claude Code and Codex conversations, Capsule uses the installed CLI
and discovers its models automatically; a separate ACP adapter is not needed.
Older conversations created through an ACP adapter keep that connection. Start
a new conversation to use the native connection without changing old history.
OpenCode, Qwen, Kimi, Kiro, Qoder and Kilo can also use their installed CLI's
built-in ACP support. Model availability and sign-in still belong to each agent;
Capsule only offers the choices that installation reports.
Favorites stay on this device. **All harnesses** opens a named list with
installation status, and **Manage harnesses** opens setup. Legacy models are grouped only when the agent
identifies them as legacy. A running conversation keeps its agent; start a new
conversation to use another one.

Before the first turn, Capsule automatically loads the selected local harness's
reported models and settings. There is no separate Start button and your draft
is not sent during discovery. Choose a model, reasoning effort, permissions, or
agent mode before sending; those choices are applied before the first prompt.
Unsupported controls stay hidden. Missing installations link to setup, and failed
discovery offers Retry. Other settings remain in
**Conversation tools → Agent settings and capabilities** and Harnesses.

Changes apply to the next turn and leave the draft untouched. Once applied to an
agent session, they are saved with the conversation for restart. Draft choices
stay scoped to the selected harness and reset when you leave that draft.
Model changes reset draft settings to the new model's defaults and can change the available effort
levels. Controls are unavailable during a turn and in a paired browser viewer.
Rejected settings show an error rather than claiming success.

Native Codex starts **Supervised**, with a read-only sandbox and approval
requests for actions that need them. **Full access** allows commands, network
access, and file changes without prompts; choose **Supervised** to switch back
before the next turn. Other agents expose their own reported permission or mode
choices. Capsule does not translate them into invented policies.

The Gateway route has separate **Read-only** and **Full access** choices.
Read-only declines actions requiring approval; it cannot display an approval
prompt. Full access approves tools automatically. Old Standard settings have
the same Gateway behavior as Full access and display that name.
To inspect the session's raw status, open **Harnesses**, select the
session with **Refresh**, and expand **Session diagnostics**. Diagnostics stay
with that session and are collapsed by default.

Switching to a different harness starts it with its own default model. A model
override from the previous harness is not carried across.

Choose **Conversation tools → Agent settings and capabilities** to inspect the selected harness and runtime
route's model, permission, steering and browser support. The same information
is available in Harnesses, and Browser describes its agent-tool limitations.
Manual browsing is separate from an agent's ability to control that browser.

Expand **Reported by agent** to inspect bounded, negotiated capability and option
metadata for the current session. A report does not enable a control that the
runtime route cannot carry. Missing information stays labelled as not reported.

The workspace strip below the prompt holds the folder, terminal, checkout mode
and branch. For Git folders, **Current checkout** or **Worktree** also offers
**Change folder**. In compact panes the workspace and branch labels become icons;
their names remain in tooltips and menus. **Conversation tools** holds prompt
stash and advanced agent settings. Supported agent controls wrap on narrow
screens; there is no separate conversation-mode selector. Menus support keyboard navigation and Escape; closing one returns
focus to its trigger.

## Read activity accurately

Expand the activity row to see its steps, **Run log** and **Verification** in
one place. Collapsing it preserves your check inputs and current log page.

Between progress messages, expand a tool group, then a step, to inspect its
reported command, text output and files. **Copy command preview** and **Copy output
preview** copy only the displayed text. Large previews are shortened and labelled.
Reported files open in that turn's checkout; workspace file-access checks still
apply. Scrolling long output stays inside the tool details. These controls inspect
work; they do not rerun commands or grant agent permissions. Commands use syntax
colors, with output beneath them. A step without readable details has no expand
control; it becomes expandable if details arrive later. Images and opaque
provider objects are not shown as raw data.

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

Send waits while attachments are being prepared. Concurrent pastes and file
selections share the eight-file limit rather than silently dropping excess files.

Pastes between 32 KiB and 2 MiB become text attachments when the runtime route
supports them. The current selection is removed only after attachment succeeds.
Use **Shift–⌘V** (or **Shift–Ctrl–V**) to keep a paste inline. Smaller, larger and
unsupported pastes stay inline. If saving or validating the attachment fails,
the pasted text goes to **Stash** and the existing draft stays untouched.

Type `@` or choose **Conversation tools → Mention a project file** to search the current
conversation’s folder. Results show the file name and parent path. Enter or Tab
attaches the selected file without sending your draft; Escape closes the picker.
File paths with spaces are preserved. Search failures and empty results are
labelled, and an older search cannot replace a newer result. Files selected here
use the same validation and removable chips as the paperclip.

Choose the paperclip or drop files onto the composer. Selected files appear as
removable chips before you send and as openable attachments in the timeline.
An attachment-only message is allowed.

On the direct route, compatible agents receive image bytes as native image
prompts and other files as embedded text or binary resources, including PDFs.
The agent must advertise the matching support; otherwise the turn reports what
could not be sent. Direct delivery reads at most 2 MiB per file and about 3 MiB
combined with prompt text, with a final 4 MiB encoded-message limit. Choose smaller
files if that limit is exceeded. Files are rechecked when read, so a missing,
changed-to-special-file or oversized attachment cannot silently become a path-only
substitute. Gateway attachment handling depends on its host and bridge.

Pasting files uses the same attachment validation as dropping them. Pasted
clipboard images are saved locally first. Attachments are desktop-only; a
paired read-only viewer cannot attach files or send messages.

One turn runs in a thread at a time, but you do not have to wait to send the
next message. A prompt sent while a turn is running joins a queue above the
composer and goes out, in order, as soon as the thread is free. Each queued
follow-up can be edited back into the composer, moved up or down, removed,
or, on routes that can steer, sent into the running turn with **Steer now**.
The queue belongs to its conversation, holds up to twenty messages, and
survives a restart. A queued message that fails to send goes to Stash like
any other. Gateway sessions also offer **Steer** during a live turn when
supported. Press `↑` in an empty prompt to recall what you asked before.
Steering drafts stay with their conversation. A pending steer cannot be sent
twice, and a newer draft is not cleared when the earlier steer finishes.
Send-and-new-conversation stays put on a rejected send. A refresh failure after
an accepted send does not restore an already-sent draft.

Capsule validates the file again at send time and gives the agent its exact
local path. A missing file is refused instead of being silently omitted. Each
turn accepts up to eight files, with a 50 MB limit per file. The harness still
applies the conversation's permission mode when it reads those paths.

## Stash a prompt

Press `⌘S` while the composer contains text or attachments to move that draft
into the prompt stash. Choose **Conversation tools → Prompt stash** to restore or
delete a stash. When the composer is empty, `⌘S` opens the stash instead.

The most recent 20 stashes are kept locally. Restoring a stash removes it from
the stash list and puts its text, attachments and selected skill back in the composer.

## Thread agents

Open **Agents** from the inspector’s launcher or **Show thread agents** in the
command palette. It shows the primary agent for this thread’s latest turn and
any structured delegated tasks reported by the runtime, in stable order. Use
**Turn** to inspect an earlier loaded turn, then choose **Latest turn** to return.
Historical activity is read only when selected; loading failures offer **Retry**.

This is not a complete roster of the agent’s internal subagents. Some harnesses
and Gateway versions do not report delegation details or task token usage.
Unknown values stay labelled **Not reported**. A completed delegation tool does
not prove a background child agent has finished, and ending the parent turn
does not mark every child complete. Task status is not verification.

The panel uses a bounded recent event window and labels partial history. It
does not start agents or control child sessions. **Manage harnesses** opens the
harness manager; **Side chat** remains a separate surface.

## Agent commands

Choose **Conversation tools → Agent commands**, or open **Agent commands** from the command palette.
Direct agents can advertise commands and optional input hints. Choose one and
press **Run command** to send a separate turn; your prompt, attachments and skill
selection remain in the composer. Commands wait for any active turn to finish.
Rejected commands show an error and are recoverable in **Stash**.

The list belongs to the current agent session. An empty or unreported list is
labelled explicitly. Gateway command discovery is not available through this
control, and paired viewers cannot send commands.

## Usage limits

When a turn stops because the provider's usage limit is reached, the
conversation says so and, when the provider named a time, when the limit
lifts. **Resume at reset** schedules that prompt to be sent again at that
time; it joins the follow-up queue when the moment comes, and a line above
the error shows the plan with **Cancel**. **Retry now** sends it again
immediately. Turn on **Auto-resume limited threads** in Settings → General to
schedule these stops without asking. Capsule must be running when the reset
arrives. Limits that name no time offer only Retry now.

## Compacting a long conversation

The context ring beside Send opens a card with the context window in use.
**Compact conversation** asks the agent to summarise its context into less,
when the agent offers that command; the card says when it does not. After
five idle minutes the card notes that the prompt cache has likely expired, the
cheapest moment to compact.
