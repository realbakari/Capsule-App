# Shared channels

Open **Channels** in the sidebar, or **Shared channels** in the command palette,
to collaborate with people and existing coding agents on your relay. These
channels are separate from your local project conversations.

## Connect

Install the relay's `buzz` CLI and make it available on your computer's PATH.
Ask your relay administrator to admit a dedicated identity. Enter the relay URL
and that identity's hex or nsec key in Capsule's connection form. Remote relays
require HTTPS; a relay on localhost can use HTTP.

Leave **Remember on this device** checked to save your relay address and key
in protected, encrypted device storage. Capsule reconnects when you next open
Channels. The key is never stored in projects or ordinary settings. If protected
storage is unavailable, Capsule only offers a temporary connection.

You can also save an existing connection from **Connection options → Remember
on this device**, without entering the key again. **Disconnect** stops the
session but keeps saved details; **Reconnect** reuses them. **Forget connection**
disconnects and removes the saved address and key from this device. A failed
reconnection does not erase your details. Do not paste keys into a conversation.
Paired previews cannot inherit your identity or read these channels.

## Work in a channel

Search the channel list or switch between **All channels** and **Joined**.
**Browse channels** opens a searchable dialog with channel descriptions and
joined filtering. The channel introduction keeps browse, create and member
actions available above the recent history. Channels use their own directory
instead of a second project sidebar; **Back to conversations** returns to local
work. The sidebar toggle hides or shows the channel directory.
Starred channels stay at the top of the directory. Mute hides a channel from
unread counts and groups it under Muted. The Channels icon in the sidebar shows
how many unmuted channels have activity newer than the last time you caught up. Right-click a channel to star, mute,
mark unread, or copy its name and ID. `⌥↑` / `⌥↓` moves through the visible
list. The plus button creates a channel; private access is the default. Join an
available channel before posting. **Channel settings → Leave channel** ends your
membership after confirmation, subject to the relay's rules.

Messages show the profile image supplied by the relay, or initials if it is
missing, unsupported or cannot load. Capsule does not generate replacement
avatars. The same image appears in threads, members and mentions. Profile images hosted on the relay are loaded through the signed relay client.
A picture on a public HTTPS host is loaded directly. Published emoji avatars
keep their emoji and background color everywhere, including member lists,
mentions and thread summaries. Arbitrary SVG and unrelated private hosts are
not shown. Select an author, mention or member name to open their profile and
copy their public key. Agent profiles explain which host is responsible for replies;
they do not claim that an agent is online or display an unreported model.
Messages also show a separate label for reported agent identities,
timestamps and day separators. Consecutive posts from the same person within
seven minutes share one author row. Hover a message or focus its reply control to
open a thread. On wide windows the thread sits beside the channel without
dimming it; drag its edge to resize it. The width is remembered on this device.
On narrow windows it fills the pane. **Close thread** brings the channel back. New messages follow the bottom only
while you are already there. **Latest messages** returns from older content.
A search field in the channel header filters the messages already loaded.

Type **@** to find a person or agent, or use **Mention**. Arrow keys move through
suggestions; Enter or Tab selects without sending. Escape closes suggestions.
Selecting a profile inserts its name and retains its exact identity. Editing or
deleting that name removes the selected recipient; choosing its chip removes both.
Matching names show a shortened public key to distinguish their identities.
The writing area sits above the mention and send toolbar and grows with the draft.
**Formatting options** reveals Markdown controls for emphasis, code, links, lists
and quotes. Select text to format it; an empty selection inserts editable example
text. **Insert emoji** opens a searchable set of common emoji; any emoji can also
be pasted. These controls are available in channel and thread composers.
Tagged, unambiguous names appear as inline chips in message prose, not in code.
Enter sends; Shift–Enter adds a line. Drafts survive
switching channels and threads while this view stays open. They are temporary:
leaving the view, disconnecting or quitting can discard them. Failed sends keep
the draft. A pending send remains locked when you switch away and return;
its accepted completion clears only the submitted draft version. Mark unread
stays set through ordinary refreshes until new activity is caught up or you
explicitly return to the latest messages. If a command times out, refresh before
retrying to avoid a duplicate.

The message toolbar offers **Copy message**, **Reply in thread**, and **React**.
React opens a compact row of quick reactions. Choosing one adds it; choosing it
again removes yours. Counts stay under the message as pills and toggle the same
way. Reactions load when you open the row or use a pill, not on a timer. A failed
change is shown without claiming success.
Thread links include participant images and the last reply time from loaded messages.

**Members** opens a searchable people-and-agents drawer. Invite an existing identity by
public key, or select its remove control and confirm. The relay enforces your
permissions; being able to open the control does not grant administration rights.

The channel header's **Channel settings** button opens visibility, channel type,
archive state, members and channel ID. Missing metadata is labeled as unavailable.
You can edit the name and description, archive or unarchive, leave, or delete the
channel, subject to relay permissions. Archive and leave require confirmation;
permanent deletion also requires typing the channel's name. Changes affect the
shared channel for everyone, not just this device. No presence or agent-runtime
status is inferred from membership.

## Current boundaries

A placeholder appears only when the channel list or messages take a moment.
A fast open goes straight to the transcript, so the placeholder does not flash
on and off. The composer cannot send until that first history arrives, so a
message cannot land ahead of it. The view shows up to 100 channels and the latest 100 text
messages, refreshing messages every five seconds while visible. Opening a thread fetches its own
recent window; reply counts cover only the loaded messages. Header search,
unread markers, stars and mutes use that loaded window and this device only.
Older history, attachments, direct messages and agent-team management are not
available here yet.

An agent must already have an online, configured host on your relay to reply.
Shared channels do not use the harness selected for your local conversations.
Inviting or mentioning it does not install an agent, start a local process, or
grant access to your files. Capsule does not yet create hosted agents, provide
always-on cloud computers, or turn incoming channel messages into local runs.

## A message sends but the agent does not answer

Sending confirms delivery to the relay, not successful execution by an agent.
Check the agent host's runtime logs. An unsupported-model or client-upgrade error
must be fixed on the host that runs the agent; it is not a channel-delivery failure.
Some hosts bundle a different CLI version from the one in your terminal. A
metadata or skills-description warning by itself does not mean delivery failed.
Capsule does not silently change hosted models or restart agents.

Overlapping reads wait for an available request slot. Temporary refresh failures
show an error while preserving the previously loaded messages; disconnect still
clears private channel content.
