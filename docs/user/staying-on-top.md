# Keeping track of conversations

With several agents working at once, Capsule keeps track of which conversations
you have read, which you are done with, and which you want to see again later.

## Unread

A conversation whose latest turn finished since you last looked at it shows a dot
beside its name. Opening it marks it read. To come back to it later, choose
**Mark unread** from its menu or press `⇧⌘U`.

When you open a conversation with news, a line marked **New since your last
visit** shows where you left off.

## Settle

**Settle** means "done, but keep it close". A settled conversation folds into a
**Settled** shelf at the end of its project, so the active list holds only what
still needs you. It comes back by itself as soon as its agent starts a new turn,
or choose **Return to active**.

Hover a conversation in the sidebar for a one-click **Settle** in place of its
age. A settled conversation offers **Return to active** there instead, and a
snoozed one **Wake now**. A conversation that is working or waiting for your
decision offers none. Click the **Settled** or **Snoozed** shelf to open it; its
count sits where the ages are.

`⌘E` settles the conversation you are in and opens the next one waiting for
you: a decision first, then anything that finished or failed while you were
away. If nothing is waiting, you stay where you are.

## Snooze

**Snooze…** hides a conversation until a time: later today, this evening,
tomorrow morning, next Monday, or a time you pick. Snoozed conversations sit in
a **Snoozed** shelf showing when they wake. A conversation wakes at that time, or
earlier if its agent starts a new turn. A conversation that is working or waiting
for your decision is never hidden.

Settle and snooze both offer **Undo** for a few seconds, also on `⌘Z`.

Open a settled or snoozed conversation and a line under its last turn says so,
with **Return to active** or **Wake now**, so you can tell even when you
reached it from search or a link rather than the shelf.

## Approvals

**Approvals** in the sidebar collects every request waiting on you across your
projects, grouped by the conversation that asked, with its project and **Open
conversation**. The cards are the ones the conversation shows: **Approve once**,
**Always allow…**, **Deny**, and **Deny and reply**, which denies and opens the
conversation with the message box ready. A paired device that can only read
sees the requests without the buttons.

## Notifications

Capsule tells you about a conversation in one of three ways, depending on where
you are:

- **Reading that conversation:** nothing. You can see it.
- **Elsewhere in Capsule:** a notice in the corner names the conversation, says
  what happened, and offers **Open**. It goes away when you open that
  conversation.
- **Capsule in the background:** a desktop notification names the conversation
  and says what happened. Click it to open that conversation.

What happened is one of: finished, failed (with the first line of the reason),
hit a usage limit (with when it resets, if the agent said), needs your approval
(with what it wants to do), has a question (with the question), is running a
long command, or is back from snooze. Snoozed and settled conversations stay
quiet unless they are waiting on your decision.

When several conversations finish or need you at once, they arrive as one
notification, such as "2 conversations need you", that opens the most urgent
one. A conversation's newer notification replaces its older one, and a
notification leaves Notification Center once you have opened its conversation.

The Dock icon counts conversations waiting on you: a decision, a failure, or a
finished turn you have not read. It goes down as you read. The menu bar extra
counts only the decisions and failures. Its menu starts with what is waiting
(or says nothing needs you), lists those conversations with their project, and
then offers **New Conversation**, a **Recent** list, **Show Capsule**, the
**Desktop Companion** switch, **Settings…** and **Quit Capsule**. The window title shows the same count, for example
"Capsule (3)".

Settings › General starts with **Notify me**, which sets what reaches you while
Capsule is in the background: **Everything** (finished turns, approvals and long
commands), **When I'm needed** (only when an agent waits on you), or **Only in
the app** (no desktop notifications, and no Dock badge or bounce). **In-app
notifications** turns the notices in the corner on or off. **Notification
sound** plays the system sound with each desktop notification; your Mac's Focus
and Do Not Disturb still silence it. The individual switches, one for each kind
of notification plus the Dock bounce and badge, are under **Advanced**. Change
one yourself and Notify me reads **Custom**. On Windows, the taskbar button
flashes where a Mac's Dock icon would bounce.

A screen reader hears another conversation's news even when no notice appears,
for example with **In-app notifications** off: Capsule announces it politely,
after whatever is being read. Snoozed conversations stay silent.

Notices in the corner wait while you are away. Their time runs only while the
Capsule window is visible and in front, and while the pointer or keyboard is
not on them. An error notice has a copy button for its text and **Show more**
when the reason is longer than three lines. When the corner is full, a plain
notice never pushes out one that offers **Undo** or another action; it waits
for a free spot instead.

## When an agent asks you something

Some agents stop to ask a question with a few choices, such as which database to
use. Capsule shows the question with its choices in the conversation. Press a
number to pick, `Enter` to continue, or type your own answer where the agent
allows it. **Don't answer** lets the agent carry on with its own judgement.
Answers to secret questions are hidden while you type and are not kept in the
conversation.

Not every agent can ask this way. Those that cannot ask their question in their
reply instead.

## After a restart

If Capsule quits in the middle of a turn, that turn is stopped. With Settings ›
General › **Continue after a restart** on, Capsule queues that turn's prompt
again when it reopens, so the agent picks up where it left off. The prompt waits
in the conversation's queue, where you can remove it before it is sent. Turns
running through a Gateway are left alone, because the Gateway may still be
working on them.

## Finding your place

Capsule remembers how far you had scrolled in each conversation and takes you
back there. `F6` moves between the sidebar, the conversation, the message box
and the side panel.

When Capsule is watching a pull request for a conversation and the pull request
merges, that conversation is settled for you. Turn this off in Settings › Source
control › **Settle merged conversations**.

## Arranging projects

Drag a project in the sidebar onto another to put it in that place. A project
you add later appears at the top until you move it.
