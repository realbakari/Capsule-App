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

## Notifications

When Capsule is in the background, a notification names the conversation and
says what happened: finished, failed, needs approval, has a question, or a snooze
ended. Click it to open that conversation. While you are in the app, the same
news about other conversations appears in the corner with **Open**.

The Dock icon counts conversations waiting on you: a decision, a failure, or a
finished turn you have not read. It goes down as you read.

Settings › General has switches for each kind of notification, the Dock badge
and the notification sound.

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
back there. Long conversations show a thin timeline at their right edge: point
at a mark to see which turn it is, click to jump to it. `F6` moves between the
sidebar, the conversation, the message box and the side panel.

When Capsule is watching a pull request for a conversation and the pull request
merges, that conversation is settled for you. Turn this off in Settings › Source
control › **Settle merged conversations**.

## Arranging projects

Drag a project in the sidebar onto another to put it in that place. A project
you add later appears at the top until you move it.
