# Your first conversation

1. Install and sign in to a supported coding CLI using that tool's own setup.
   Capsule does not supply a subscription or install the CLI.
2. Add a project folder with the sidebar's folder-plus control. Start with a
   disposable repository when trying a new agent or permission mode.
3. Choose the agent in the composer. Open **Harnesses** and **Check this agent**
   if it reports a missing prerequisite. Gateway-only agents need a connected
   OpenClaw Gateway with ACP enabled; direct-capable agents can use direct mode
   on this Mac. See [Providers and credentials](providers.md).
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

Learn more: [Drafts and attachments](composer.md), [projects and previews](projects-and-previews.md),
[checking a turn](verification.md), and [restoring a turn](checkpoints.md).
