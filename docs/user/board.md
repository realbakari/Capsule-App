# The board

The board shows your conversations as cards in columns, so you can see what is
waiting, what is working and what is finished at a glance. Every card is an
ordinary conversation: open one and it is the same thread you would reach from
the sidebar. Nothing on the board is kept anywhere else.

Open it from the sidebar's grouping menu (**Board**, next to By project, By
status and Recent) or from the command palette (**Board**). It shows the
current project; switch to **All projects** in the board's top bar to see
every project at once. Choosing a grouping in the sidebar menu returns to the
conversation.

## Columns

- **Draft** — a card with a prompt written but not sent.
- **Queued** — a card waiting for other cards to be marked done.
- **Running** — the agent is working.
- **Needs you** — the agent is waiting for an approval, the turn failed, or the
  card is waiting on a card whose turn failed or was stopped.
- **Review** — the agent finished. The card stays here until you mark it done.
- **Done** — you marked it done.

A card shows its agent, its branch when it has its own worktree, the latest
thing the agent did, and how long it has been running or since it last changed.
Conversations with no turns and no prompt written are not shown.

## Making a card

Press **New card** in the board's top bar, the `+` on the Draft column, or run
**New board card** from the command palette. Write the prompt, and optionally a
title, the agent, and whether the card works in its own worktree (the default
for cards, so several can run at once without touching each other's files) or
in the project folder. A project that sets its own default keeps it, and a
project that is not a Git repository always uses its folder.

**Start now** sends the prompt straight away. **Save as draft** keeps it for
later; press **Start** on the card when you are ready. Sending a message
from the card's conversation also starts it.

## Chaining cards

A card can wait for other cards. Pick them under **Depends on** when you make
the card, use the card's **Depends on** menu, or ⌘-click the first card and
then ⌘-click the card that should come after it. Press Esc to cancel a ⌘-click
link. The card shows **After …** with the cards it waits for, and the same
menu removes a link. Links that would make two cards wait for each other are
refused. Linking a draft that waited on nothing makes it start on its own;
the **Depends on** menu has **Start on its own when these are done** to turn
that off or on again.

A chained card starts on its own only when every card it waits for has been
**marked done** by you. An agent finishing its turn is not enough: the card
before goes to Review, and the next one waits until you have looked at the
work and pressed **Mark done**. Turn off **Start on its own** when you make
the card to keep it for starting by hand instead.

If a card it waits for fails or is stopped, the waiting card moves to Needs
you and says **Blocked by …**. Fix the earlier card and mark it done, or press
**Start anyway**. **Reopen** moves a done card back to Review; cards that
already started because of it keep going.

Chains keep working with the window closed, and a card that was ready to start
when Capsule quit starts the next time it opens. A card that could not be sent
says why on the card and waits for you to press **Start** again. A card
waiting on a conversation you archived keeps waiting until you restore it or
remove the link. Deleting a conversation removes it from every card that waited
for it, and those cards wait for you to start them.

## Keyboard

Tab to the board, then use the arrow keys to move between cards and Enter to
open one.

## On another device

A paired device sees the board and can open cards. Making, linking, starting
and marking cards done happen on this computer only.
