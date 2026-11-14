# Exporting a conversation

Any conversation can leave Capsule as a Markdown file you can paste into an
issue, a pull request or your notes.

Open the conversation's menu (its name in the title bar, or its row in the
sidebar) and choose **Export as Markdown…**, or search the command palette for
**Export conversation as Markdown**. Pick what to include, then press
**Save as…** to write a file, or **Copy** to put the same text on the
clipboard. **Copy as Markdown** in the same menus copies straight away with the
options you used last.

## What the file contains

- The conversation's name as the title.
- A short header: the agent, the model if you chose one, the project, when the
  conversation started, and how many turns it has.
- Each turn under its own heading, with your prompt as a quote and the agent's
  final reply exactly as it wrote it, code blocks included. Messages you sent
  while a turn was running appear as **Steer** quotes.
- The names of attached files. Where they live on your computer is left out.
- A note when a turn failed or was stopped.

Two parts are optional:

| Option | What it adds |
| --- | --- |
| **Tool activity** | Each turn's tool calls as a short list, folded under a one-line summary such as "4 tool calls (1 failed)". Most Markdown viewers show it collapsed until clicked. |
| **Changed files** | The files each turn changed, with lines added and removed. Turns whose saved snapshots are gone are listed without files. |

Both are off until you turn them on, and Capsule remembers your choice.

Exporting the same conversation twice gives the same file, so two exports can
be compared with any diff tool. Times are written in UTC.

## On another device

A browser paired with this computer, or opened from a share link, can use
**Copy as Markdown**. Saving a file needs the desktop app.
