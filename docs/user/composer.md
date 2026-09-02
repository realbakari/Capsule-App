# Drafts, attachments, and prompt stash

Capsule keeps an unfinished draft for each conversation on this Mac. Switching
projects or conversations and returning later restores its prompt and selected
attachments. A successful send clears that draft.

## Attach local files

Choose the paperclip or drop files onto the composer. Selected files appear as
removable chips before you send and as openable attachments in the timeline.
An attachment-only message is allowed.

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
