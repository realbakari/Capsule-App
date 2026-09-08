# Projects, actions, and local previews

The titlebar keeps common project setup close to the conversation.

When saving an action, the editor stays open until the save is confirmed.
If saving fails, your command remains in the form alongside the error. Preview
URLs can use HTTP, HTTPS, or a local address such as `localhost:5173`.
Commands longer than 2,000 characters should be saved in a script; a project
can store up to 24 local actions.

## Add or clone a project

Use the folder-plus button in the sidebar to add a folder that already exists.
Use the Git branch button beside it to clone an HTTPS or SSH repository: choose
the parent directory, optionally change the folder name, then choose **Clone
and open**. Capsule creates the project only after Git finishes successfully.

Project rows use a common icon found in the project folder when one is
available. To choose another PNG, JPEG, WebP, AVIF, GIF, ICO, or SVG file, open
**Settings → Projects → Choose icon**. **Automatic** returns to folder-based
icon discovery.

## Git and conversation workspaces

Folders containing spaces work with a Gateway running on this Mac. Capsule
creates a private folder alias for the agent; your project stays in place and
keeps its original path in Capsule. The alias points to the same files, not a
copy. Gateway spawn uses this alias; direct agents receive the real path.
Live working-directory changes are unavailable: start another thread in the
desired folder instead.

A Gateway on another machine needs a path it can read on that machine. If that
path contains spaces, use a whitespace-free folder alias on the Gateway host.
This also applies to a remote Gateway reached through a local tunnel. Capsule
does not switch a thread's runtime route or move its project to work around it.

When a folder is not a Git repository, choose **Initialize Git** in the
titlebar. Git worktree conversations need at least one commit before Capsule
can create their branch.

The composer offers two workspace choices for Git projects:

- **Local** uses the project’s current checkout.
- **Worktree** creates a separate branch and folder for the conversation. Its
  agent, files, commands, Review panel, and Terminal all use that folder.

You can change this choice while a conversation is still empty. After a
message, run, or live harness exists, the workspace stays fixed. Deleting a
clean worktree conversation removes its worktree. If the worktree has
uncommitted changes, Capsule keeps it on disk rather than deleting the work.

Choose the default for new conversations in **Settings → Agents → Conversation
workspace**.

Pinned conversations stay above the rest of the project. Drag one pinned
conversation over another to save a new pinned order.

## Saved project actions

Choose **Add action** in the titlebar to save a command such as `pnpm dev` or
`npm run storybook`. Actions belong to the project and run in the current
conversation’s folder. A running action can be stopped from the same menu, and
recent output remains visible there.

After **Stop**, the action shows **Stopping** until its process exits. You can
start it again once it has stopped; repeated clicks cannot create overlapping
copies. A process that ignores the stop request is force-stopped after a short
grace period.

An action can include a preview URL. Starting it selects that address in the
Browser panel automatically.

## Local previews

Open **Browser** in the inspector to see local HTTP apps that are responding on
this Mac. The list refreshes while the panel is open and excludes listening
services that do not answer like web pages. Select a server to open it in the
in-app browser, or type another HTTP or HTTPS address above the list. The
toolbar supports back, forward, reload, an interactive element inspector,
screenshot capture to clipboard, opening in the system browser, zoom controls,
DevTools, and cache/cookie clearing. The Browser home keeps recently used pages
above the live-server list.

If server discovery fails, the last successful list stays visible with an error
and **Retry**. A failed scan is not reported as “no servers”. Page errors from
embedded frames do not replace a successfully loaded main page.

Returning home and reopening the same address reconnects browser tools to the
new page. Web popup links stay inside the browser; page-supplied custom app
schemes are blocked. Use the explicit system-browser button to leave Capsule.

Browser addresses follow the selected thread. Public addresses without a scheme
use HTTPS; loopback addresses use HTTP. **Fit panel**, **Phone** and **Tablet**
adjust the preview width for responsive-layout checks, not device emulation.
Narrow panels wrap their toolbar. Controls wait until the page is ready; a
crashed or failed page offers **Retry page**. Invalid saved history is ignored.

Direct agents that accept HTTP MCP can inspect, navigate, click, replace text,
select options, press keys, scroll, capture the viewport and read recent page
diagnostics. Open this thread's Browser panel and choose **Allow agent control**
first. This permits access to visible signed-in pages, so enable it only when
you want the agent to interact with them. **Revoke control**, switching threads,
closing or hiding Browser, or leaving Chat ends access. Agents cannot silently
control a different thread's page. Site cookies are shared between Capsule
browser pages, not separate private profiles per thread.

Element references expire when the page changes; the agent must inspect again
instead of clicking a guessed target. Dispatching an action is not verification
that the intended result happened. Password entry, uploads, rich-text editing,
downloads, permission prompts and arbitrary scripts are not automated. Downloads
and device permissions are blocked in the preview; use the explicit system
browser button when needed. Screenshots and console messages can contain
sensitive page content; diagnostics are requested explicitly and not saved.
These tools are not injected into Gateway sessions, whose browser capabilities
depend on the Gateway and agent setup. The paired viewer does not host or control
an embedded browser.

### Background pages and shared previews

In **Browser**, expand **Background page**, enter an HTTP(S) address in the
address bar, then choose **Start from address bar**. This starts a separate
temporary page for this conversation. It does not copy sign-ins from the visible
browser. You can keep using Capsule while it runs; it closes after 30 minutes,
when you choose **Close page**, or when Capsule quits. At most four background
pages can run at once. Archiving or deleting their conversation also closes them;
close background pages before restarting to install an update.

**Allow background agent control** lets a compatible direct agent target this
page instead of the visible browser. This grant survives panel changes, but
ends when revoked, when the page closes or when the owning agent process exits.
An incompatible agent cannot use it; manual browsing remains available.

**Share preview with paired viewers** separately exposes its URL and screenshots
to your paired devices. Page content may be sensitive. **Stop sharing preview**
blocks subsequent reads; it cannot erase a snapshot already received by a viewer.
Paired viewers see periodic read-only snapshots while the Browser panel is open.
They cannot navigate, type, grant access or start/close pages. This is not an
interactive stream or a browser running on a remote host. Remote access uses
your existing pairing and network settings.

The system-browser action opens the currently committed page, including after
redirects and in-page navigation. **Clear HTTP cache** clears browser cache;
**Clear cookies and storage** clears the isolated browser's cookies and saved
site data across its pages and can sign you out. Neither clears Capsule drafts
or preferences. Errors remain visible if clearing fails.

## Files and terminal ownership

An open file keeps the project, folder and revision it was read from. Navigating
elsewhere flushes its pending edit to that original file, never the new folder.
Conflicts require an explicit reload or overwrite decision.

An unsuccessful save keeps its text in this window, even after switching files.
Reopen the file to retry, copy the draft, or explicitly discard it and reload.
The Files panel also lists unsaved drafts so they can be copied if a file has
been deleted or can no longer be previewed. Recovery is temporary until the app
closes, not a disk backup. At 32 dirty files or 16 MB of draft text, further edits
are refused until space is freed; existing drafts are not evicted.

Expanded folders refresh while Files is visible. A failed listing shows an error
and **Retry**, not an empty folder. Late file-diff responses cannot replace a
newer selection or another workspace's review.

A file deleted or grown beyond the editor’s read limit since you opened it
also fails that check; an automatic save will not recreate or overwrite it.
Previews refuse special files such as pipes, and check file size before reading.
Images over 6 MB and text over 1 MB are shown as too large to preview.

**Search in files** searches the current conversation's folder, including its
worktree. Selecting a result opens that file without adding it to your draft.
Search runs in the background and ignores stale replies when you change the
query or folder. Git projects use their tracked and non-ignored files. Results
are limited to 60 matching lines, three per file; binary files and files larger
than 400 KB are skipped. Files changing during a read may be skipped too.
Search errors are shown separately from an empty result.

The interactive terminal dock keeps a shell per opened folder. Hiding it,
switching conversations or visiting Settings does not stop it. Close a shell's
tab explicitly to stop it. Quitting Capsule closes its shells. The Inspector's
Terminal remains a separate one-shot command runner.

Noisy shell output slows its producer until the terminal has rendered the previous
frame. If the producer exceeds the safety limit, that shell is stopped with an
error rather than silently dropping output. Shell completion appears after queued
output has been rendered. Scrollback keeps 1,000 lines per tab. You can retain
eight tabs per folder and 16 terminal folders; close tabs to free space.

Strict local-command policy blocks new commands, terminal starts and shell
input. It does not terminate existing commands or sandbox the coding CLI.
Stop and close remain available; close shell tabs before restoring files.

## Pull requests

The current-changes diff combines staged, unstaged, and new files, matching the
scope of **Commit all**. If a combined preview is too large, review individual
files; Capsule reports the limit instead of presenting an incomplete patch as
complete. Branch changes invalidate the current-PR reading. Merging rechecks
the branch and targets the PR you were shown; a mismatch asks you to refresh.

The Review panel lists open pull requests for the selected repository when the
GitHub CLI is installed and signed in. Select one to read its summary, review
metadata, comments and commits, or full patch without leaving Capsule. Use
**Open on GitHub** from that view to load its canonical URL in Capsule's
embedded browser.

Filter the loaded list by title, author, branch, or PR number, and sort by recent
updates or creation time. The list shows up to 50 open pull requests. **Refresh**
asks GitHub for a new result. If a read fails, **Retry** tries again and any last
successful result stays visible; a connection failure is not shown as an empty
repository.

In **Code**, choose **All commits** or an individual commit to inspect its
changes without checking out another branch. Switch between split and unified
diffs, collapse a file, or expand and collapse the current page. **Summary** renders
comment Markdown and lists checks with links to their output.
Code is syntax-coloured, and long lines wrap by default while keeping both sides
aligned. Turn **Wrap lines** off to scroll horizontally instead. File headers
remain compact when collapsed.
Large patches show ten files per page, with large files initially collapsed.
An expanded file shows up to 160 rows per page. Use **Next**, **Previous**, or
the page number to reach the rest. Review notes still use the original file
line numbers, not page-relative numbers. Saved turn diffs use these controls too.
HTML review badges appear as labelled links instead of raw tags, and hidden bot
metadata is omitted. Tables retain their columns, and expandable sections can
be opened in place. Code examples remain literal, including nested fences.
Comments appear in collapsible cards and can be sorted in either direction.
Timeline groups consecutive comments and reviews; expand a group to read them,
or select a commit title to inspect that commit's diff. Merge and close events
use the dates reported by GitHub. The newest events appear first by default.
Collapsing a comment only changes this view; it does not resolve a conversation
on GitHub. Review-thread resolution and publishing reviews are not available here.

Use a line's **+** control in the full-PR diff to write a review note. Notes keep
track of the old or new side of the diff. **Use in thread** places notes or a
comment into your draft so you can review it before sending it to the agent;
**Copy notes** copies them instead. These controls do not publish reviews or
comments to GitHub. Use **Open on GitHub** to submit a review on GitHub.

Web links in conversation Markdown also open in the embedded browser. Use the
browser toolbar's external-open action only when you want the system browser.
The same panel still owns changed files, commits, push, and creating a draft or
ready pull request for the current branch.

The Review panel keeps your commit message if a commit fails. While a commit
is pending, the form prevents duplicate submissions. A successful commit clears
the message; switching workspaces starts a separate draft. An empty message or
a clean working tree leaves **Commit** unavailable with an explanation.

The pull request action menu can prepare a question, explanation request or
fix request in your thread draft. These actions do not send the message for you.
Escape closes the menu and returns focus to its button.
