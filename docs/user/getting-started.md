# Your first conversation

The terminal icon in the title bar opens a terminal drawer under the
conversation, in the conversation’s folder. You can also use **Show terminal**
in the command palette, or `⌘J`. Hiding the drawer (the chevron at its right,
or `⌘J` again) keeps running shells; closing a tab ends its shell.

Tabs are named **Terminal 1**, **Terminal 2** and so on; **+** opens another
in the same folder, and a closed tab's number is used again. Pointing at a tab
shows the folder its shell is in. Typing `exit` or pressing `Control-D` closes
the tab, as in any terminal app. A shell that ends with an error keeps its tab,
marked with the exit code, so you can read what it printed before closing it.

Drag the drawer's top edge to resize it, or focus that edge and use the arrow
keys. Double-click it to go back to the standard height. The drawer never
covers more than three quarters of the window. The terminal keeps the last
10,000 lines of output, uses your code font (including a custom one from
**Settings → Appearance**), and follows the light or dark theme as soon as it
changes.

Links in terminal output are underlined when you point at them, and a hint
says what a click does. A click keeps you inside Capsule; `⌘`-click leaves it.

- **A local server** (`localhost`, `127.0.0.1`, `0.0.0.0`, `*.localhost`):
  click to open it in this conversation's **Browser**. `⌘`-click opens your
  default browser instead.
- **Any other web address** needs `⌘`-click, which opens your default browser.
  A plain click does nothing, so selecting text never sends you away.
- **A file**, such as `src/app.ts:12:3` from a compiler or test runner: click to
  open it in **Files**. Paths are read from the shell's folder, and only files
  inside this conversation's folders become links.

A link that wraps onto the next row is still one link. On Windows and Linux,
use `Ctrl` where these notes say `⌘`.

To ask about some output, select it. **Add to chat** appears beside the
selection; click it, press `⌘L` (`Ctrl+Shift+L` on Windows and Linux), or
right-click and choose **Add Selection to Chat**. The text lands in the message
you are writing, at the cursor, as a code block named after the folder (and the
tab, when more than one is open), and
the cursor moves to the message so you can type your question. A selection
longer than 200 lines or 12,000 characters keeps its end, where errors usually
are, and says how much was left out. **Attach Selection as Context** attaches
the selection to the message as context instead of typing it in. The
right-click menu also has **Copy**, **Paste**, **Select All**, **Scroll to
Bottom** and **Clear**.

The icons beside it open the panel next to the conversation, one surface at a
time: **Review** for changed files, **Browser**, and **Files**. **Simulator**
joins them on a Mac when the project is an iPhone or iPad app (an Xcode
project, a Swift package, or a React Native, Flutter or Expo app) or a
simulator is attached to the conversation. Click the icon that is showing to
close the panel. The list icon shows this conversation's details: where it
runs, its branch, how full its context is, what changed, and what is running.
A dot on it means Capsule could not read the folder's Git status; the reason
is under **Changes**. **More** (⋯) holds **Agents**, **Side chat**, any panel
not shown on the bar (Simulator for other projects, Review for a folder that
is not a Git repository), and **Keep computer awake**.

1. Pick an agent and a folder. On a new installation, Capsule opens one setup
   page with both. Under **Agent**, install any agent that is missing or sign
   in to one; under **Folder**, open a folder on this computer or clone a
   repository. **Start a conversation** opens a conversation in that folder
   with the cursor in the message box. It says which agent the conversation
   starts with: the one you use when it is ready, otherwise the first ready
   one. If no agent is ready yet, you can still start, and the conversation
   shows how to install or sign in. Capsule notifies you when a turn finishes
   or needs you; change that under **Notifications** in **Settings → General**. **Set up later**
   skips setup and leaves a **Finish setup** checklist in the sidebar;
   **Set up Capsule** in the command palette opens it again. Capsule installs
   an agent only when you press **Install**, and it does not supply a
   subscription. See [Installing and signing in](providers.md#installing-and-signing-in).
2. To add another project, use the sidebar's folder-plus control. A
   conversation with no folder offers **Open a folder** and **Clone a
   repository** in the same place, because agents work inside a folder. Start
   with a disposable repository when trying a new agent or permission mode.
3. Choose the agent in the composer. Open **Agents** and **Check this agent**
   if it reports a missing prerequisite. Gateway-only agents need a connected
   OpenClaw Gateway with ACP enabled. New installations default to local agents
   in Direct mode, without a Gateway connection. Existing preferences are kept;
   choose **Settings → Agents → New conversations → Advanced → Where agents
   run** to change the default for new conversations. See [Providers and credentials](providers.md).
4. Start a conversation. Choose **Local** for the existing checkout or
   **Worktree** for a separate Git branch and folder. Review the permission
   description before sending a small, specific task.
5. Watch the reply and work log. If a direct agent asks for approval, inspect
   the request and approve once or deny. **Stop** asks the active agent to stop;
   an unconfirmed stop is reported, not shown as completed work, with
   **Close agent** to end the agent's process.
6. Review the changed-files card and the Review panel. Save a test/build command
   through **Add project action** in Conversation details (the list icon in the titlebar), then select it in the turn's Verification section to
   record a local check. A reply or green tool indicator alone is not proof.

A failed send keeps your draft. The first message in a new conversation opens
it at once; if the send fails, the draft returns to that conversation's
composer. Sending and starting another conversation only advances after the
send is accepted. Review the diff and relevant checks before
committing or pushing.

New conversations take a short, readable title from the first prompt's first
line, or the first attachment's name when no text was sent. This happens locally
without another agent request. Later prompts do not rename the conversation;
your own title is preserved. **Generate title** in the conversation menu restores
a title from that original prompt.

During a turn, compact tool groups sit between the agent's progress updates.
Expand a group for its reported steps. If the agent reports a plan or todo
list, a **Tasks** card sits above the composer with the current step, a
completed count, and an expandable list. After the turn finishes, everything
between your prompt and the final answer folds under one row: the tool groups
and the progress notes the agent wrote along the way. The row reads **Worked
for…** with the time the turn ended, or **You stopped after…** when you stopped
it. Expand it to read the progress again; the run log and checks sit at its
foot. Missing tool completion is shown as unknown rather than inferred from the
turn finishing. A turn that failed, or ended without an answer, keeps a **Turn
details** row of its own. Only recently loaded activity is shown inline in long
histories.

A message's time and its actions (copy, edit from here, branch, rate) appear
when you hover it. A long prompt folds to its first lines; **Show full message**
opens the rest.

Learn more: [Drafts and attachments](composer.md), [projects and previews](projects-and-previews.md),
[checking a turn](verification.md), and [restoring a turn](checkpoints.md).

## Organize conversations

Use **Group conversations** (the list icon beside the sidebar search) to switch between **By project**
(the default), **By status** and **Recent**. This view preference stays on this device.

- **Needs you** collects approvals, blocked turns and failed conversations.
  Each row still distinguishes an approval from a failure.
- **Working** includes running, queued and waiting turns.
- **Ready for review** means the latest turn completed with an answer, not that
  its work was verified or that you have not read it.
- **Other conversations** includes new, cancelled and other settled threads.

Status rows include their project names. Search matches either the project or
conversation name. Waiting and working groups stay fully visible; settled groups
offer **Show more** and **Show fewer**, keeping the selected conversation visible.
Pins sort first within a status group. Return to **By project** to drag pinned
conversations into a custom order; switching views keeps project expansion state.

**Recent** lists every conversation across projects in activity order, each with
its project's name, instead of the project tree. It highlights the selected
conversation and offers the same hover actions. `⌃Tab` steps
through the same order from anywhere.

Beside the sidebar search sit its other controls: **Group conversations**,
**Add project**, and **New conversation** (`⌘N`). Right-click New conversation for
a temporary conversation or one from a GitHub issue.

Each conversation row shows its agent's mark and how long ago it last changed.
Hover over a conversation or focus it with the keyboard to reveal **Settle** (see
[keeping track of conversations](staying-on-top.md)) and the **···** menu, which
holds pin, archive and everything else. A pinned conversation's pin unpins it
when clicked. A folded project shows how many conversations it holds and whether
one is working, failed, or waiting for your approval; hover it for its pull
requests, **New conversation** in that project, and its **···** menu. Pause on the row to see its full title and project. A project
preview shows its folder and conversation count. Press Escape to dismiss a preview.
The selected conversation stays visible even when older conversations are collapsed.

Pull request marks on worktree conversations are described in
[Organizing conversations](organizing-conversations.md).

## Conversation controls and activity

The model control at the left of the composer's footer holds the agent's
settings for the next turn, its reported commands and its capabilities. `@`
mentions files, `$` attaches a skill, and `/` lists commands. Individual tools
and connected tool servers are managed by your agent, not toggled here.

While work is running, the activity summary shows the current tool even when the
group is collapsed. Select that step to open its reported input, output, and
files in one click. Earlier failures remain marked without hiding ongoing work.
Expand the summary to inspect all reported steps. Missing output is labelled,
not treated as a successful result.

## Public preview

The public site introduces the workspace with a product preview, a visual
feature tour, and a task-to-review walkthrough. **Features** explains the
workflow; **Resources** has searchable guides grouped by topic. **Story**,
**Updates**, **Development**, **Pricing**, **FAQ**, and **Support** cover the
product’s purpose, releases, current limits, costs, setup questions, and help.
These pages share navigation with the privacy, security, and terms pages.

Use the feature tabs with a pointer or the arrow keys. Illustrated actions
explain the workflow but do not execute work. On narrow screens, **Explore
Capsule** opens the navigation. Setup questions expand individually.
**Build from source** includes a copyable installation command and a manual-copy
fallback when clipboard access is unavailable.

The website shows a read-only sample of the interface, not a running agent or
your own workspace. Its displayed project, conversation and connection state
are sample data. Download the desktop app to send messages or use workspace
controls. Smaller screens show a labelled task-and-diff illustration instead
of the desktop preview. Neither preview executes code.

The download section offers separate macOS Apple Silicon and Windows x64
downloads, with release notes and checksums. The Windows download is an unsigned
preview. Read its installation guidance before running the installer. Agent
accounts and usage costs are separate from Capsule.
