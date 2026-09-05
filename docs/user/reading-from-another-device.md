# Reading from another device

Capsule can serve the workspace to a browser on your phone or another Mac, so
you can watch a long run without sitting at the machine doing it.

If the connection drops while a request is waiting, Capsule reports the lost
connection and discards that request. It does not repeat it on reconnect.

A paired device can **read**. It cannot send a prompt, open a terminal, run a
project action, write a file, or change a setting. Those are a separate scope,
and nothing in the app hands one out.

## Turning it on

**Settings → Gateway → Read from another device.**

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

A link is **single use** and lasts **five minutes**. Pairing a second device
means creating a second link. A paired device stays paired for twelve hours of
elapsed time since pairing, then has to pair again, even if it stayed connected.

## Taking access away

Every paired device is listed under **Paired devices** with a **Revoke**
beside it. Revoking immediately closes that device's live connections and stops
event delivery. Replies still being read are not delivered after revocation.

Setting the reach back to **Off** revokes everything at once.

## What a paired device can do

It runs the same app you are looking at, so it looks familiar, but the parts
that act on your machine refuse. Concretely, it can read:

- conversations and their transcripts, as they stream
- diffs, changed files, and file contents in the project
- runs, their events, and the process monitor
- git status, branches, and pull requests
- settings, harnesses, and skills — as values, not as controls

And it is refused, by the server rather than by the interface, on anything
that would: send a message, spawn or steer a harness, start a terminal, run or
stop a project action, write or stage a file, commit, push, create or merge a
pull request, resolve an approval, change settings, pick a folder, or install
a skill.

A refusal comes back as an error naming the channel, so a viewer that tries
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

**The address does not load on my phone.** The reach is probably **This Mac**.
Phones cannot reach `127.0.0.1` on your laptop — switch to **This network**.

**The link says it is invalid.** It has already been used or it is older than
five minutes. Create another.

**The page loads but shows the marketing site.** That page was opened without
a pairing link and has no stored session. Open a fresh link.

**It stopped updating.** The socket reconnects on its own every couple of
seconds; if it does not come back, the desktop app has quit or the setting was
turned off.
