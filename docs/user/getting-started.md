# Your first conversation

The **Terminal** button in the conversation header opens a bottom drawer in the
conversation’s folder. You can also use **Show terminal** in the command palette
or `⌘J`. Hiding the drawer preserves running shells; closing a shell tab ends it.
For a single command with captured output, use **Commands** in the inspector.

1. Install and sign in to a supported coding CLI using that tool's own setup.
   Capsule does not supply a subscription or install the CLI.
2. Add a project folder with the sidebar's folder-plus control. Start with a
   disposable repository when trying a new agent or permission mode.
3. Choose the agent in the composer. Open **Harnesses** and **Check this agent**
   if it reports a missing prerequisite. Gateway-only agents need a connected
   OpenClaw Gateway with ACP enabled. New installations default to local agents
   in Direct mode, without a Gateway connection. Existing preferences are kept;
   choose **Settings → Agents → Runtime** to change the default for new
   conversations. See [Providers and credentials](providers.md).
4. Start a conversation. Choose **Local** for the existing checkout or
   **Worktree** for a separate Git branch and folder. Review the permission
   description before sending a small, specific task.
5. Watch the reply and work log. If a direct agent asks for approval, inspect
   the request and approve once or deny. **Stop** asks the active agent to stop;
   an unconfirmed stop is reported, not shown as completed work.
6. Review the changed-files card and the Review panel. Save a test/build command
   through **Add action**, then select it in the turn's Verification section to
   record a local check. A reply or green tool indicator alone is not proof.

A failed send keeps your draft. Sending and starting another conversation only
advances after the send is accepted. Review the diff and relevant checks before
committing or pushing.

New conversations take a short, readable title from the first prompt's first
line, or the first attachment's name when no text was sent. This happens locally
without another agent request. Later prompts do not rename the conversation;
your own title is preserved. **Generate title** in the conversation menu restores
a title from that original prompt.

During a turn, compact tool groups sit between the agent's progress updates.
Expand a group for its reported steps. If the agent reports a plan or todo
list, a **Tasks** card sits above the composer with the current step, a
completed count, and an expandable list. After the turn finishes, earlier work
folds under **Worked for…** while the final answer remains visible. Expand it to
read the progress again. Missing tool completion is shown as unknown rather
than inferred from the turn finishing; **Turn details** retains diagnostics and
verification. Only recently loaded activity is shown inline in long histories.

Learn more: [Drafts and attachments](composer.md), [projects and previews](projects-and-previews.md),
[checking a turn](verification.md), and [restoring a turn](checkpoints.md).

## Organize conversations

Use **Group conversations** above the sidebar list to switch between **By project**
(the default) and **By status**. This view preference stays on this device.

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

## Public preview

The website shows a read-only sample of the interface, not a running agent or
your own workspace. Its displayed project, conversation and connection state
are sample data. Download the desktop app to send messages or use workspace
controls. Smaller screens show a labelled task-and-diff illustration instead
of the desktop preview. Neither preview executes code.

The download section offers separate macOS Apple Silicon and Windows x64
downloads, with release notes and checksums. The Windows download is an unsigned
preview. Read its installation guidance before running the installer. Agent
accounts and usage costs are separate from Capsule.
