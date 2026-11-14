# Capsule on iPhone and iPad

The mobile app follows your threads from anywhere your phone can reach your
computer. Replies and tool steps appear as they stream. You can see what each
turn changed, and with a phone pairing you can send messages, stop a run and
answer approvals. Agents keep running on your computer; nothing runs on the
phone.

## Pair your phone

1. On your computer, open **Settings → Gateway → Browser access**.
2. Set **Who can reach it** to **This network**. Use **This computer** only if
   the phone is a simulator on this computer.
3. Under **Phone**, choose **Pair a phone**. A code appears. It works once and
   expires in five minutes.
4. In the app, tap **Pair with your computer**, then **Scan pairing code**.
   You can also point the Camera app at the code, or copy the link and paste
   it into the app.

The app shows your threads as soon as pairing finishes.
- **How long it lasts.** A phone pairing lasts thirty days from the last time
  the phone connected, so a phone you use stays paired. Restarting or
  updating Capsule on your computer doesn't end it.
- **If your computer's address changes.** The app finds it again on the same
  network by itself. For a VPN or private-network address, set it under
  **Settings**: touch and hold the computer, then choose **Edit address**.
  Either way, the app checks the computer's identity before it sends
  anything.
- **Ending pairings.** Turning Browser access **Off** ends every pairing.

### Why a phone code instead of the browser link

The phone code carries your computer's address and a fingerprint of its
security certificate. The app connects encrypted and checks the certificate
against that fingerprint. Nobody else on the network can read the connection
or pretend to be your computer, and that is why a phone paired this way can
send messages and answer approvals over your home or office network.

A browser link pasted into the app also works, but over plain HTTP it is
**read only**, as it is in a browser.

## What you can do

- **While you were away.** When you come back to the app, a summary at the
  top of the list shows what happened since you left: turns that finished,
  failed or stopped, with the first line of what the agent said, and anything
  waiting on you first. Tap a line to open the thread, or **✕** to dismiss it.
- **Threads** are grouped by status: **Needs you** (waiting on an approval,
  or failed), **Working**, **Pinned**, then **Recent**. Each row shows its
  project and agent, with a small mark for each agent. A dot marks a turn that finished since you last looked.
  **Group by project** in the **…** menu lists threads under their project
  instead.
- **Tidy the list.** Swipe right to pin or mark as read or unread; swipe left
  to archive. Touch and hold for **Rename**, and the same actions. Each one
  offers **Undo** for a few seconds. Deleting a thread stays on your
  computer.
- **Search** looks through thread titles and, while connected, the text of
  every message. Tap a message result to open the thread at that message.
- **Transcript.** Each turn's steps fold under your message; tap the summary
  to see each tool call, and the agent's plan if it made one. Tap a step to
  see the command it ran and what came back. A running turn shows its current
  step and a **Stop** button. Days are marked as the transcript crosses
  midnight, and touching and holding a message shows when it was sent.
- **Images.** Photos and screenshots sent with a message show as
  thumbnails; tap one to zoom or share it. The phone shows the computer's
  preview of the image, not the full-size file. An image in an agent's reply
  loads only when you tap it, so a reply can't make your phone fetch
  anything on its own.
- **Changes.** Opens the files a turn changed, with a line-by-line diff for
  each. Within a changed line, the words that changed are highlighted. Tap
  lines to select them, then **Ask about these lines** to quote them in the
  message box.
- **Code.** Code in replies and in project files is coloured for common
  languages.
- **Send and queue.** Type in the message box and send. While a turn is
  running, the send button becomes **Queue**: your message waits and is sent
  when the turn finishes, even if you close the app. The **queued** strip
  above the box lets you reorder or remove what's waiting. **Stop** sits
  beside the turn's timer.
- **Dictate.** The microphone beside the send button transcribes on your
  phone. The words go into the message box for you to edit and send; nothing
  is sent while you speak. **✓** keeps what was heard, **✕** puts the box
  back the way it was.
- **Agent commands.** Typing **/** also lists the commands the thread's agent
  says it accepts, such as `/review`. Picking one puts it in the message; the
  agent runs it when you send.
- **Mode and skills.** Under the message box, the mode chip (**Agent**,
  **Code**, **Plan**, **Research** or **Chat**) sets how the next turn works,
  and the thread keeps it. **Skill** adds one of the project's skills to the
  next message; you can also type **/** and part of a skill's name.
- **Attach.** With a phone pairing, **+** attaches photos from your library,
  a photo from the camera, or a text file, up to 3 MB each. Photos are
  reduced to 2048 pixels before they're sent. Files go to a folder Capsule
  keeps on your computer for that thread; nothing else on your computer can
  be attached from the phone.
- **Approvals.** The card shows what the agent wants to run, why, and where.
  Choose **Allow once** or **Deny**, or **Deny and reply** to decline and
  tell the agent what to do instead in your next message. With a phone pairing you can also choose
  **Allow for this thread**, which lasts until that agent session ends. You
  can answer from the notification too: **Allow once** and **Deny** ask you
  to unlock first. If an answer can't be confirmed, the app tells you and
  doesn't resend it. Standing permissions are changed on your computer.
- **New thread.** The compose button starts a thread in a project's folder,
  with the mode and agent you pick, under supervised permissions.
- **Thread links.** **Copy link** in a thread's **…** menu gives a link that
  opens the thread on any device paired with that computer.
- **Project.** From a thread's **…** menu, or by touching and holding a
  thread in the list, open its project. Three tabs:
  - **Changes**: the working tree's branch and every uncommitted file, each
    with its line-by-line diff.
  - **Files**: browse, or search by name, and read the project's files.
    Markdown files show formatted, with a switch to the source. **Ask about
    this file** starts a message that mentions it; **Copy path** copies its
    path.
  - **Pull requests**: open pull requests with their checks. Tap one for its
    description, every check, the files it changes with their diffs, and the
    conversation. Merging and reviewing stay on your computer.

  The project view is for reading only; commits, pushes and file edits stay
  on your computer.

The app needs iOS 26 or later.

### From the Lock Screen and Home Screen

- **Live Activity.** While a turn you started or watched from the app is
  running, it shows on the Lock Screen and in the Dynamic Island: the thread,
  the step the agent is on, and how long it has been going. When the agent
  asks for an approval, the request and the command appear with **Allow
  once** and **Deny**; both ask you to unlock first. When the turn ends it
  shows how it finished for a few minutes, then goes away. Turn it off in
  **Settings → Live Activities**.

  iOS only lets the app start one while it's open, so a turn that starts
  while Capsule is closed doesn't get one.
- **Widget.** The Capsule widget shows how many threads need you and how
  many are working, and lists them on the larger size. Tap one to open it.
  It's also available on the Lock Screen. It updates when the app hears from
  your computer.
- **Quick actions.** Touch and hold the app icon to open one of your three
  most recent threads.

### More than one computer

With more than one computer paired, the phone stays connected to up to three
others as well as the one you're looking at. An approval on another computer
notifies you, shows under **On your other computers** at the top of the list,
and puts a dot on the computer menu, which also shows each computer's state.
You can answer from the notification without switching; opening the thread
switches to that computer.

### Sharing into Capsule

Choose **Capsule** in another app's share sheet to keep text, a link or up to
four photos for a new thread. The next time you open Capsule it offers them in
**New thread**, where you pick the project and start it. Nothing is sent until
you do.

### On iPad

The project and a turn's changes open in a column beside the conversation;
the thread list steps aside while it's open. **Open in New Window** from a
thread's context menu puts it in its own window.

### Try it without a computer

**Try a sample workspace** on the welcome screen, or in **Settings**, opens a
made-up project with a few threads. You can open a diff, answer an approval
and send a message; the "agent" replies from the app itself. Nothing is sent
anywhere. **Exit** in the banner leaves it.

Read-only pairings show everything above but say **Read only** where the
message box would be.

### With a keyboard

| Keys | Action |
| --- | --- |
| ⌘↩ | Send |
| ⌘. | Stop the running turn |
| ⌘N | New thread in the most recently active project |
| ⌘F | Search |
| ⌘1 – ⌘9 | Open one of the first nine threads |
| ⌘R | Refresh |
| ⇧⌘D | Latest turn's changes |
| ⇧⌘P | Project |
| ⌘, | Settings |
| Esc | Close a sheet |

Hold ⌘ on an iPad keyboard to see these. With a pointer, rows and buttons
highlight under it.

### Accessibility

- **VoiceOver.** VoiceOver announces when a turn in the thread you're reading
  finishes or fails, and when an approval arrives. On an approval card, the
  **Actions** rotor offers **Allow once**, **Deny** and, where available,
  **Allow for this thread**.
- **Text size.** Text follows your text size setting. At the largest sizes,
  thread rows put the project and agent on their own lines instead of
  cutting them off.
- **Feedback.** The phone gives a light tap when an approval arrives and when
  a turn finishes in the thread you're reading.

## When the connection drops

- **Settings**, then a computer, shows its address, when the phone last
  connected and the last problem it hit, and how much space the saved copy
  takes, with **Clear saved copy**.
- If the computer couldn't load something, the screen says so and offers
  **Try again**, rather than showing an empty list.
- **Settings → About** shows the version of Capsule on your computer, and
  asks you to update it if it's too old for this app.

- The app keeps a copy of your recent threads and shows it while offline,
  with a note saying when it was saved.
- It reconnects on its own, sooner when your network comes back or you
  return to the app. **Retry now** reconnects at once.
- Anything you were sending when the connection dropped is **not** sent again
  automatically. The message stays in the box; check the thread before
  sending it again.
- If the pairing expired or was revoked on your computer, the app says so and
  offers **Pair again**.

## Notifications

The app can tell you when an agent needs an approval and when a turn
finishes. It checks while open, for a short time after you leave it, and
occasionally in the background when iOS allows. Notifications don't arrive
while the app is fully closed; that needs a push service, which is planned.
Notifications show the thread's title, never message contents. In
**Settings** you can turn them off, turn off approval notifications, or have
finished turns notify **All**, **Only failures** or **None**.

## Settings

- **Display** has **Theme** (System, Light or Dark) and **Reading text**,
  which sets agent replies in a serif, the system font or a rounded one. Code,
  tables and the rest of the app always use the system font.
- **Backdrop from your computer.** If your computer's theme draws a scene
  behind conversations (Grain, Mesh, Night, Dots or Paper), the phone draws
  it too, kept faint enough that text stays easy to read. Backdrop images stay
  on the computer. Turn this off to keep the plain background.
- **Usage limits** shows each agent's session and weekly limits as last
  reported by a running agent. It isn't a live balance.

## Privacy

The app talks only to the computers you pair. Conversations are not sent to
any other server. Pairings are stored in the device's keychain and are not
restored to other devices from a backup. **Settings → Forget** removes a
computer and its saved copy from the phone. To cut off access on the computer
too, choose **Revoke** next to the device under **Paired devices**.
