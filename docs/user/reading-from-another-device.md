# Using Capsule in a browser

Pairing failures show a recovery page instead of opening a demonstration
workspace. Get a fresh pairing link from the host and keep it running. If an
established connection drops, loaded conversations stay visible while Capsule
retries with increasing delays. Pending actions are not repeated automatically.

Capsule can serve the workspace to a browser on your phone or another Mac, so
you can watch a long run without sitting at the machine doing it.

The Usage page can read cached subscription observations from running native
Muse conversations on the host. Refreshing this view does not start an agent or
query a provider. Changing an agent's reasoning default remains host-only.

If the connection drops while a request is waiting, Capsule reports the lost
connection and discards that request. It does not repeat it on reconnect.
After reconnecting, the viewer refreshes saved workspace and conversation data
and reconciles it with live updates. If a device falls behind, its stream is
closed and reconnected rather than building an unlimited queue on the desktop.
An individual response too large for the viewer shows an error; open that
content on the desktop instead.

A paired device can **read** by default. Existing pairings stay read-only.
To send prompts, create a new **Conversation control** pairing on the host.
Control also permits new threads in existing projects, stopping runs, and
once-only approval decisions. New threads are Supervised and use the project's
local folder. Existing threads keep their permissions and runtime route.
Your installed agents still own execution; no agent runs inside the browser.

Control does not include terminals, direct file writes, local attachments,
opening new project folders, shared channels, or changing host settings. Agents
may still edit files and run commands under their thread's permissions. Only
give control to a device you trust. Supervised agents may refuse tools; adjust
a thread's permissions from the desktop if you need a different policy.

## Turning it on

**Settings → Gateway → Browser access.**

| Setting | What it does |
| --- | --- |
| **Off** | Nothing is listening. This is the default. |
| **This Mac** | Serves on `127.0.0.1`. Only this computer can reach it. |
| **This network** | Serves on every interface. Anything that can route to your Mac can load the page — pairing is still required to see anything. |

Choosing an option starts or stops the listener immediately; there is no
restart. Turning it off closes every socket and forgets every paired device.

## Starting it from a terminal

If you launch Capsule from a terminal, `--remote` turns this on for that run
and prints the pairing link where you started it:

```bash
open -a Capsule --args --remote
```

or, running the app binary directly:

```bash
/Applications/Capsule.app/Contents/MacOS/Capsule --remote
```

```
Capsule is readable at http://127.0.0.1:51101
Pair a device: http://127.0.0.1:51101/#pair=zh9C7r5kJKkIcaOheXX48keKOv0
The link works once and expires in five minutes. Read only.
```

`--remote=network` opens it to the local network instead of this Mac. The flag
applies to that launch; it does not change the setting.

From a source checkout, the launcher owns the arguments, so use the
environment variable instead:

```bash
CAPSULE_REMOTE=loopback pnpm dev
```

## Pairing a device

1. Set it to **This Mac** or **This network**.
2. Note the **Address** shown underneath — that is what you open on the other
   device. On "This Mac" it is `127.0.0.1`, which only works in a browser on
   this computer; for a phone you need **This network**.
3. Press **Create link**. The link is copied to your clipboard.
4. Open it on the other device.

The page pairs itself and the workspace appears.

The permission selector defaults to **Read only**. **Conversation control** is
available on This computer, or through an HTTPS address configured by the host
administrator. A plain HTTP local-network connection stays read-only. The
browser banner shows which permission it received. On the same computer, open
the generated loopback link in your browser. From another device, the host needs
a trusted HTTPS proxy or private tunnel configured before creating the link.
The proxy must serve the full workspace, not just the marketing website.

A link is **single use** and lasts **five minutes**. Pairing a second device
means creating a second link. A paired device stays paired for twelve hours of
elapsed time since pairing, then has to pair again, even if it stayed connected.

## Pairing a phone or tablet

The Capsule mobile app pairs with a **phone code** instead of a link. Under
**Phone**, choose **Pair a phone** and scan the code with the app. The
connection is encrypted and tied to this computer, so a phone can send
messages, stop runs and answer approvals even on **This network**. See
[Capsule on iPhone and iPad](mobile-app.md).

## Taking access away

Every paired device is listed under **Paired devices** with a **Revoke**
beside it. Revoking immediately closes that device's live connections and stops
event delivery. Replies still being read are not delivered after revocation.

Setting the reach back to **Off** revokes everything at once.

**Disconnect** in the browser forgets that tab's credential. To invalidate a
copied credential too, use **Revoke** on the host. Neither action cancels work
already accepted by an agent; stop that run separately if needed.

## Sharing one conversation

A pairing opens the whole workspace. To show someone a single conversation
instead, give them a **share link**. It opens that conversation read-only:
its messages, tool activity, the changes each turn made, and its artifacts.
Nothing else is visible: no other conversations or projects, no files, no
settings. The holder cannot send messages or answer approvals.

1. Open the conversation's menu (its name in the title bar, or its row in the
   sidebar) and choose **Share read-only link…**. The command palette has the
   same entry.
2. Choose how long the link works: **1 hour**, **1 day**, **7 days** or
   **Never**.
3. Press **Create link**. It is copied to your clipboard and shown once.

The dialog lists the conversation's active links with a **Revoke** beside each.
**Settings → Gateway → Browser access** lists every active link across all
conversations.

A share link uses the same listener as pairing, so it reaches whatever the
**Who can reach it** setting allows: this computer only, or your network. If
browser access is off, the dialog says so and offers to turn it on for this
computer. Unlike a pairing link, a share link can be opened more than once and
by more than one person, until it expires or you revoke it.

Revoking a link takes effect at once. A browser that has it open loses access
straight away, its next request is refused, and it shows that the link expired
or was revoked. Deleting the conversation revokes its links too.

A link points at this computer's address. Capsule reuses the same port each
time it starts, so links keep working after a restart. If another app has taken
that port in the meantime, Capsule picks a new one and older links stop
loading; create a new one. Links made while reachable on your network also stop
loading when this computer's network address changes.

## Seeing who is viewing

When another device has a conversation open, the title bar shows it beside the
conversation's name: **Also open on iPhone**, **Open from a share link**, or
**2 viewers** when there are several. Hover or focus it to see each device and
when it connected. Nothing is shown while only this computer is viewing.

**Settings → Gateway → Browser access** lists the devices connected right now
and the conversation each one is reading. A paired device counts as viewing the
conversation it opened last.

## What a read-only paired device can do

It runs the same app you are looking at, so it looks familiar, but the parts
that act on your machine refuse. Concretely, it can read:

- conversations and their transcripts, as they stream
- diffs, changed files, and file contents in the project
- runs, their events, and the process monitor
- git status, branches, and pull requests
- settings, harnesses, and skills — as values, not as controls

Terminal output never leaves this computer. A paired device of any kind cannot
start a terminal, and it does not receive what one prints either, so a
command that shows a token or a credentials file stays on your screen.

And it is refused, by the server rather than by the interface, on anything
that would: send a message, spawn or steer a harness, start a terminal, run or
stop a project action, write or stage a file, commit, push, create or merge a
pull request, resolve an approval, change settings, pick a folder, or install
a skill.

A read-only refusal comes back as an error naming the channel, so a viewer that tries
gets told rather than silently ignored.

## What to know before using "This network"

- **The connection is plain HTTP.** On a network you do not control, anyone
  positioned between the devices can read the traffic, which includes your
  conversations and file contents.
- **The pairing link is the credential.** Anyone who gets a copy within its
  five minutes can pair. Send it somewhere private.
- **The session token is a bearer token.** A device that has paired holds a
  secret in its browser's session storage; anyone with that secret can read
  the workspace until it expires or you revoke it.

On a home or office network these are usually acceptable. On a café network,
prefer **This Mac** and a tunnel you already trust.

## Troubleshooting

Turning access **Off** waits for the listener to stop, including when a start
was still pending. A shutdown failure stays visible rather than claiming the
listener is off. Change the setting again to retry.

**The address does not load on my phone.** The reach is probably **This Mac**.
Phones cannot reach `127.0.0.1` on your laptop — switch to **This network**.

**The link says it is invalid.** It has already been used or it is older than
five minutes. Create another.

**The page loads but shows the marketing site.** That page was opened without
a pairing link and has no stored session. Open a fresh link.

**It stopped updating.** The socket reconnects on its own every couple of
seconds; if it does not come back, the desktop app has quit or the setting was
turned off.

On a phone, the sidebar opens as a drawer from the toggle at the top left and
closes when you pick a conversation, so the conversation always gets the full
width. A read-only pairing says so in the message box.
