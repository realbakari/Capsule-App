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
edit and send. A run of tool calls in a reply folds into one line that says
what the agent did, such as "Read 6 files, ran 2 commands (1 failed), edited
3 files". A file read twice counts once, and a failure is always named next to
the work that failed. Open the line to see each step, and open a step to see
the command and its output.

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
Favorites are saved with your settings, so every window and a paired device
see the same stars. `⌥⌘M` moves to the next favorite of the selected agent,
skipping any model the agent no longer offers. **All agents** opens a named list with
installation status, and **Manage agents** opens setup. Legacy models are grouped only when the agent
identifies them as legacy. A running conversation keeps its agent; start a new
conversation to use another one.

Before the first turn, Capsule automatically loads the selected local harness's
reported models and settings. There is no separate Start button and your draft
is not sent during discovery. Choose a model, reasoning effort, permissions, or
agent mode before sending; those choices are applied before the first prompt.
Unsupported controls stay hidden. Missing installations link to setup, and failed
discovery offers Retry. Other settings remain in
**Conversation tools → Agent settings and capabilities** and Agents.

Changes apply to the next turn and leave the draft untouched. Once applied to an
agent session, they are saved with the conversation for restart. Draft choices
stay scoped to the selected harness and reset when you leave that draft.
Model changes reset draft settings to the new model's defaults and can change the available effort
levels. Controls are unavailable during a turn and in a paired browser viewer.
Rejected settings show an error rather than claiming success.

### Approvals: Ask, Auto and Full

The shield chip in the composer sets how much the agent may do before you say
yes. It applies to the conversation; **Settings → Agent defaults → Approvals for
new conversations** sets the starting choice. The command palette offers
**Approvals: Ask**, **Auto** and **Full** too.

- **Ask**: every edit and command asks first.
- **Auto**: reads and edits inside the conversation's folder go ahead.
  Commands, web requests and anything outside the folder ask.
- **Full**: nothing asks.

Each choice in the menu says how this agent and route carry it, because they
differ:

- **On this computer**, Capsule answers the agent's own permission requests from
  your choice and shows you the rest. A change applies to the next request, even
  mid-turn. The agent's own mode still decides what it asks about: Claude Code's
  default mode asks for edits and commands, so all three choices hold. Codex in
  its own auto mode edits workspace files and runs sandboxed commands without
  asking, so under Ask and Auto those never reach you; set its agent mode to
  read-only for every edit to ask. The menu names the agent mode that matches
  each choice where Capsule knows it.
- **Through the Gateway**, the agent cannot show a prompt. Ask refuses tools that
  need approval instead of asking, and Auto lets commands run as well as edits.
  Full approves everything.

Auto-approved work is recorded in the turn's activity as "Allowed under Auto"
or "Allowed under Full". A paired read-only viewer sees the choice but cannot
change it.

Some agents also report their own permission or mode setting, such as Codex's
sandbox. Those appear beside the chip as **Agent permissions** and **Agent
mode**, with the agent's own names. Capsule does not translate them.
To inspect the session's raw status, open **Agents**, select the
session with **Refresh**, and expand **Session diagnostics**. Diagnostics stay
with that session and are collapsed by default.

Switching to a different harness starts it with its own default model. A model
override from the previous harness is not carried across.

Choose **Conversation tools → Agent settings and capabilities** to inspect the selected harness and runtime
route's model, permission, steering and browser support. The same information
is available in Agents, and Browser describes its agent-tool limitations.
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

## Plan mode

The **Plan / Act** chip beside the model control decides what the next turn
does. In **Plan**, the agent reads and investigates, then replies with a
numbered plan instead of changing files. In **Act**, it works with the
conversation's permissions. Press `⇧Tab` in the prompt, click the chip, or use
**Switch to Plan mode** in the command palette. Each conversation keeps its own
choice; **Settings → Agents → Plan mode → Start in Plan mode** makes new
conversations begin in Plan.

Hover the chip to see how a plan turn is held to planning:

- **Enforced by Claude Code** uses Claude Code's own plan mode. When Claude
  finishes its plan, the plan is the reply and the turn ends; nothing is edited.
- **Read-only, enforced by Codex** runs the plan turn in Codex's read-only
  sandbox without approval prompts.
- **Enforced by** another agent means the agent reported a plan mode of its own,
  and Capsule switches it on for the plan turn and back for Act. This works on
  the Gateway route too.
- **Asked, not enforced** means the agent has no plan mode Capsule can switch.
  Capsule asks it to plan without editing, but cannot stop it from changing
  files. The chip's border is dashed in this case.

When a plan turn finishes, **Act on this plan** switches to Act and asks the
agent to implement the plan above. **Keep planning** stays in Plan and returns
you to the prompt. Both appear under the latest plan and in the task list.

In the model control, **Plan** and **Act** on a model's row save it for that
mode. Switching mode then switches to that model too. Saved choices are listed,
and can be cleared, in **Settings → Agents → Plan mode → Plan and Act models**.
When a conversation starts in Plan, the agent starts with the Plan model.

A paired browser without conversation control sees the plan, not the chip or
the buttons.

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

When the context ring turns amber or red, its card says so and offers **New
conversation** beside **Compact conversation**: compact to keep going on the same
task, start fresh for something unrelated.

The empty composer says what its keys do right now: in a new conversation it
names what it understands (`@` files, `$` skills, `/` commands), in a conversation already under way it shows the send
key you chose in Settings, and while a turn is running it says that sending
queues the message.

**Settings › General › Follow-ups** decides what sending during a running turn
does: queue it for after the turn (the default), or steer the running turn
where the agent supports it. Attachments and skills always queue, and a steer
the agent refuses is queued instead, with a note saying so.

**Settings › Appearance** sets the **Time format** (system, 12-hour or 24-hour)
for message times, and whether **Tool calls** start folded to one line or
listed in full.

**Settings › General › Confirmations**: deleting a conversation asks first
unless you turn that off; archiving can ask first too (off by default, since
Archive offers Undo). Deleting a project always asks.

Press **Esc** in the composer to stop the turn that is running, the same as the
Stop button. Esc closes an open menu first.

One turn runs in a thread at a time, but you do not have to wait to send the
next message. A prompt sent while a turn is running joins a queue above the
composer and goes out, in order, as soon as the thread is free. Each queued
follow-up can be edited back into the composer, moved up or down, removed,
or, on routes that can steer, sent into the running turn with **Steer now**.
The queue belongs to its conversation, holds up to twenty messages, and
survives a restart. Queued messages go out when their conversation is free
even if you have switched to another one or closed the window. While the
thread cannot send, for example while the Gateway is disconnected or the
agent needs a login, the next message waits at the front of the queue with
the reason and is tried again every thirty seconds. Gateway sessions also offer **Steer** during a live turn when
supported. Press `↑` in an empty prompt to recall what you asked before.
Steering drafts stay with their conversation. A pending steer cannot be sent
twice, and a newer draft is not cleared when the earlier steer finishes.
Send-and-new-conversation stays put on a rejected send. A refresh failure after
an accepted send does not restore an already-sent draft.

Capsule validates the file again at send time and gives the agent its exact
local path. A missing file is refused instead of being silently omitted. Each
turn accepts up to eight files, with a 50 MB limit per file. The harness still
applies the conversation's permission mode when it reads those paths.

## Attach context

Besides files, the composer can attach a conversation, a diff, the project's
check output, a web page, a selection or a command's output. Each becomes a
chip under the prompt that says what it is. Hover or focus a chip to preview
the start of it, or click it to keep the preview open; **×** removes it. Each
attachment is Markdown, at most 200 KB, and counts toward the eight-attachment
limit. While one is being prepared its chip shows a spinner; if it fails, the
chip says why and stays until you dismiss it. Nothing is sent until you send.

These sources are offered only in the desktop app. A paired browser does not
see them, because each one reads from this computer, runs a command or
reaches the network.

### @thread

Type `@thread` (or `@th` and pick it) and choose another conversation. This
project's conversations come first, then the rest. The attachment holds that
conversation's prompts, steers and final replies, oldest first, without tool
steps or progress messages. A long conversation keeps its most recent turns
and says how many earlier messages it left out.

### @diff

Type `@diff` and choose **Branch changes**, everything since this branch left
the default branch, or **Uncommitted changes**, staged and unstaged edits
against the last commit. A diff with nothing in it is reported instead of
attached. A long diff is cut to fit and says so.

### @diagnostics

Capsule does not run a language server, so it does not invent diagnostics.
`@diagnostics` runs the project's own check command in the conversation's
folder and attaches its exit code and the end of its output. The check is the
project action marked **Use as the project's check** (or `"check": true` in
`capsule.json`). Without one, Capsule uses the `typecheck`, `lint` or `check`
script in `package.json`, in that order, run with the project's package
manager. If there is none, the chip says **No check command found** and links
to **Project actions**. The check stops after three minutes. Strict sandbox
blocks it.

### @url

Type `@url`, then an address, and press Enter. Capsule fetches the page,
keeps its readable text (headings, paragraphs and lists, not scripts or
navigation) and attaches up to 200 KB of it. Pages that do not answer within
ten seconds, are not text, or are larger than 1 MB are refused or cut, and the
chip says which. Addresses on a private network (your router, another
machine on the LAN, a cloud metadata address) are refused, including when a
public page redirects to one. Type `localhost`, `127.0.0.1` or `[::1]` to
fetch a server on this computer. The request carries no cookies or sign-in.

### Send selection to thread

Select text in the terminal, in a file preview or on a page in the browser,
then right-click and choose **Send selection to thread**, or choose it from the
command palette. A file selection is quoted with its path and line range, such
as `src/app.ts:12-30`. A page selection is quoted with the page's address. The
browser's **More options** menu has the same command.

## Run a command with !

Start the prompt with `!`, as in `!git log --oneline -5`, and press Enter.
Capsule runs the command in the conversation's folder instead of sending it to
the agent, then attaches the exit code and the last part of the output as a
chip. The prompt is cleared so you can write what you want the agent to do
with it. A hint under the prompt says what Enter will do. Commands stop after
sixty seconds; a failed start puts the command back in the prompt. Strict
sandbox blocks commands, and a paired browser cannot run them.

## /init

`/init` asks the agent to write or refresh `AGENTS.md`, the file coding agents
read at the start of every turn. The prompt names the instruction files the
project already has (`AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`,
`.claude/CLAUDE.md`, `GEMINI.md`) so the agent reads them first and refreshes
rather than duplicates. It asks for verified commands, layout and conventions,
in under 200 lines. Choosing `/init` sends it right away. **Write AGENTS.md**
(or **Refresh AGENTS.md**) beside the instruction files in the project's
settings, and **Write or refresh AGENTS.md** in the command palette, start a
new conversation with the same prompt drafted so you can read it first.

## Saved prompts

Type `/` to see saved prompts alongside commands. A project's own, from its
`capsule.json`, are marked **Project**; your own, from **Settings › General ›
Saved prompts**, are marked **Personal**. A prompt can have blanks:
`{{file}}` asks for text and `{{focus:bugs|performance}}` asks you to pick.
Choosing a prompt with blanks opens a small form above the prompt; **Insert
prompt** fills them in and puts the text in the composer, after anything you
already wrote. A prompt without blanks goes straight in. Nothing is sent
until you send.

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
does not start agents or control child sessions. **Manage agents** opens the
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
immediately. Both send the turn's attached files again too. Turn on
**Auto-resume limited conversations** in Settings → General to schedule these stops
without asking; an automatic resume waits at least a minute, and after three
limit stops in a row it stops and leaves the next try to you. Capsule must be
running when the reset arrives. Limits that name no time offer only Retry now.

## Compacting a long conversation

The context ring beside Send opens a card with the context window in use.
**Compact conversation** asks the agent to summarize its context into less,
when the agent offers that command; the card says when it does not. After
five idle minutes the card notes that the prompt cache has likely expired, the
cheapest moment to compact.

## Continuing in a new thread

**Continue in a new thread…** starts a fresh thread from a summary of this
one. It is in the context ring's card, the conversation's menu and the
command palette. The dialog offers:

- **Agent.** The same agent by default, or any other, so you can hand the
  work to a different agent with a clean context.
- **Summary.** Capsule drafts it from the thread's prompts and final replies,
  newest kept when the thread is long. Edit it down to what the next thread
  needs.

The new thread opens in the same folder, titled "(continued)", with a link
back to the thread it came from. The summary goes with your first message
there, once; until you send it, you can read it at the top of the thread. The
original thread is not changed.

The summary is written from the transcript rather than asked of the agent, so
it works for every agent, on direct mode and through the Gateway, and whether
or not the agent is still running. It costs no turn.
