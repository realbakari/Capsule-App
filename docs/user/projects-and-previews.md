# Projects, actions, and local previews

Drag the sidebar or inspector edge to resize it. Releasing commits the final
position; cancelling the drag or leaving the window ends resizing. Inspector
width is remembered within its supported range, while keeping space for the
conversation. Collapsed project rows prioritize waiting approvals over working
or failed turns so a pending decision remains visible.

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
icon discovery. Choosing an icon updates it immediately. If you edit an icon
file outside Capsule, it can take up to a minute to appear.

## Open in another app

**Open in** opens the conversation's folder, or a file, in an app installed on
this computer. Find it in **Conversation details** (the list icon in the
titlebar), under the folder, and beside **Open** when you preview a file in
**Files**.

On a Mac the list is what macOS reports can open that folder or file, with each
app's own name and icon. Many editors do not tell macOS they open folders, so
yours may be missing: choose **Add app…** and pick it from Applications. On
Windows and Linux the system gives no such list, so **Open in** offers the
default app plus the programs you add.

The app you choose becomes your favourite. The button then reads **Open in**
followed by its name, and `⌥⌘O` opens the conversation's folder there. The
arrow beside it chooses another app.

**Settings → Projects → Open in** lists the apps for folders. The star sets or
clears the favourite, **Remove** takes an app off the list, and **Show removed
apps** brings back the ones macOS reported that you removed.

Open in only opens what belongs to the conversation: its folder, its worktree,
and the project's other folders. A paired browser does not show it, because it
has no apps of its own to open this computer's files in.

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

When a folder is not a Git repository, open **Conversation details** (the list
icon in the titlebar) and choose **Initialize Git in this folder**. Git worktree conversations need at least one commit before Capsule
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

### Apply a worktree to your checkout

When a worktree conversation has work you want in the project folder itself,
choose **Apply to local checkout**. It is in **Conversation details**, in the
menu on the conversation's name in the titlebar, and in the command palette as
**Apply worktree to local checkout**.

Everything the worktree holds lands in the project folder as unstaged changes:
commits on the worktree's branch, edits not yet committed, and new files.
Deleted and renamed files, and images and other binary files, come across too.
Your staging area is left alone, so you review and commit in the project folder
the way you normally would. The worktree conversation keeps working afterwards.

When the project folder already has its own edits to the same lines, Capsule
still applies, and those files get the usual conflict markers. A dialog lists
them and offers three ways forward:

- **Open Review** shows the project folder's changes.
- **Ask the agent to resolve** starts a new conversation in the project folder
  with the list of conflicted files and the branch they came from.
- **Undo apply** puts the files back.

A clean apply shows a notice with the number of files and an **Undo** button.
Until the conversation's next turn, Conversation details also shows **Applied
to local** with the time and an **Undo** link. Undo restores only the files the
apply touched, to how they were just before it, and removes files it created.
Edits you made to other files since are kept. Undo also replaces any edits you
made to the applied files after applying.

Apply is unavailable, with the reason shown, when the worktree has no changes,
when a turn is still running, or when the project folder is in the middle of a
merge, rebase, cherry-pick or revert, or has unresolved conflicts. A device
reading this computer through a pairing link does not offer it.

### Which branch a worktree starts from

A new worktree branches from the repository's remote default branch, usually
`origin/main`, not from whatever the project folder has checked out. Capsule
fetches that branch first when it has not fetched it in the last five minutes.
If the fetch fails, for example offline, the worktree starts from the copy
fetched earlier and the engine log says so. A project with no `origin` remote
has nothing to fetch, so its worktrees start from the project folder's current
commit (`HEAD`).

While a worktree conversation is still empty, **from** beside the workspace
choice in the composer picks another base. It lists the default, then remote
and local branches by most recent commit, with a search field. Changing it moves
the empty worktree's branch to the new base. Once the worktree has changes or
its own commits, the base stays fixed.

To change the default for one project, open the project page and set
**Worktree base**. **Default** follows the remote default branch.

The new branch has no upstream, so a push never aims at the base branch by
mistake. Both local and Gateway agents work in the resulting folder the same way.

Choose **Settings → Source control → Worktree location** to store new worktrees
in another folder or on another drive. The location belongs to the computer
running Capsule. **Use default** restores Capsule's application-data location.
Changing this setting does not move existing worktrees or change their agents'
working folders. Existing worktrees still follow the same clean/dirty deletion
rules. Both local and Gateway conversations use their saved working folder.

Pinned conversations stay above the rest of the project. Drag one pinned
conversation over another to save a new pinned order.

## Conversation details

The list icon in the titlebar opens **Conversation details**, which holds the
workspace controls in one place: the folder with **Reveal in Finder** and
**Open in Terminal**, the branch, **Add project action** or **Run a project
action**, **Commit & push** (commit, push and create a pull request), and
**Initialize Git in this folder** when the folder has no repository. The
titlebar itself carries only the conversation's name and the panel icons.

## Instructions for agents

Project settings list the instruction files at the project's root that coding
agents read on every turn (`AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`,
`.claude/CLAUDE.md`, `GEMINI.md`), each with its length and an **Open** button.
A file over 200 lines is marked **worth trimming**: every line costs context on
every turn, and long files bury the rules that matter.

## Saved project actions

Open **Conversation details** (the list icon in the titlebar) and choose **Add project action**; once a project has actions the row reads **Run a project action**. Use it to save a command such as `pnpm dev` or
`npm run storybook`. Actions belong to the project and run in the current
conversation’s folder. A running action can be stopped from the same menu, and
recent output remains visible there.

After **Stop**, the action shows **Stopping** until its process exits. You can
start it again once it has stopped; repeated clicks cannot create overlapping
copies. A process that ignores the stop request is force-stopped after a short
grace period.

An action can include a preview URL. Starting it selects that address in the
Browser panel automatically.

A running action also appears under **Background tasks** in the conversation
details (the list icon in the titlebar), with how long it has run. Open its row
to see its latest output, or stop it from there.

## Local previews

The Browser panel has tabs. **+** in its header opens a new tab on the local
servers page; each tab keeps its own address and title, and **×** closes it.
Switching tabs loads that tab's page again, so scroll position and typed form
input are not kept across a switch. Page width (fit, phone, tablet) is in the
⋮ menu with zoom.


For a native iOS app, open **Simulator** instead; see [iOS Simulator](simulator.md).

Open **Browser** in the inspector to see local HTTP apps that are responding on
this Mac. The list refreshes while the panel is open and excludes listening
services that do not answer like web pages. Select a server to open it in the
in-app browser, or type another HTTP or HTTPS address above the list. The
toolbar supports back, forward, reload, inspect mode, device sizes,
screenshot capture to clipboard, opening in the system browser, zoom controls,
DevTools, and cache/cookie clearing. The Browser home keeps recently used pages
above the live-server list. Screenshot capture copies an actual image that can
be pasted into an image-aware app. If capture fails, it shows an error and leaves
the clipboard unchanged; it never substitutes image data as text.

**Inspect mode** (the pointer button, or **Inspect element in browser** in the
command palette) outlines the element under the pointer with its tag and size.
Click to pick it: the current conversation's composer gets a **Page element**
chip with the element's CSS selector, its HTML (cut at 6,000 characters), key
computed styles and the page address, plus a cropped screenshot of the element as
an image. An element scrolled out of view is attached without a screenshot.
Press Esc or the button again to stop without picking.

The **device size** button shows the page's current size. Choose **Responsive**
to fill the panel, or **iPhone** (393 × 852 at 3x), **iPad** (820 × 1180 at 2x)
or **Desktop** (1440 × 900 at 1x). A fixed size keeps its width and scrolls inside
the panel when the panel is smaller, and the page sees that device's pixel ratio
and mobile screen mode (touch input is not emulated). The palette offers **Browser size** entries for each.
Inspect and device sizes are on the desktop only; a paired viewer does not show
them.

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
diagnostics. Open this thread's Browser panel, open **Page control off** (the shield
at narrow widths) in its toolbar,
and choose **Allow agent control**
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

An operation started under an older control grant cannot return page data after
that grant is revoked, even if control is enabled again. Key presses work in
background pages without bringing a window to the front. If another debugger
owns the page, the key operation asks you to retry instead of taking it over.

In **Browser**, open the **Page control off/on** toolbar menu and expand **Background
page**, enter an HTTP(S) address in the
address bar, then choose **Start from address bar**. This starts a separate
temporary page for this conversation. It does not copy sign-ins from the visible
browser. You can keep using Capsule while it runs; it closes after 30 minutes,
when you choose **Close page**, or when Capsule quits. At most four background
pages can run at once. Archiving or deleting their conversation also closes them;
close background pages before restarting to install an update.

**Allow background agent control** lets a compatible direct agent target this
page instead of the visible browser. This grant survives panel changes, but
ends when revoked, when the page closes or when the owning agent process exits.
Start a compatible direct agent in this thread before enabling the grant.
An incompatible agent cannot use it; manual browsing remains available.
Background pages support WebSocket connections used by live apps and reloaders.

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

In a narrow Files panel, the file list fills the panel. Select a file to see its
preview; **Toggle workspace tree** returns to the list. Wider panels show both
side by side. A slow preview will not pull you back after you switch tools or
close the panel, and changing folders never shows the previous folder's files.

An open file keeps the project, folder and revision it was read from. Navigating
elsewhere flushes its pending edit to that original file, never the new folder.
Conflicts require an explicit reload or overwrite decision.

If a branch disappears after you opened the branch picker, checkout fails without
restoring a same-named file over your local edits.

Files opened from chat or content-search results use that conversation's folder,
even if the Files panel was showing an extra folder. File-filter results disappear
while a different query or folder loads. Failed searches show **Retry**, not an
empty result.

To watch the agent work, turn on **Follow agent** with the pointer button in
the Files header (also in Settings › Appearance and the command palette). While
a turn runs, Files opens the file the agent is reading or editing and expands
the folders above it. As soon as you open a file, a folder or a filter
yourself, following pauses for the rest of that turn; **Follow again** resumes
it, and the next turn follows on its own. A file you are editing is never
replaced. Follow agent is off until you turn it on, and Capsule remembers your
choice. It needs an agent that reports which file it is working on; with one
that does not, Files stays where you left it.

Select a previewed image to inspect it at **Fit** or **100%**, then zoom in or out.
Scroll, drag, or use arrow keys to pan at a fixed zoom. **Close** or Escape returns
to the file preview. This does not edit the original image.

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

**Settings › Source control** sets the **Diff layout** for Review and pull
request diffs (side by side or one column), whether **Diff files** start open
or folded, and whether Review starts with **Ignore whitespace** on. Turn diffs
in the conversation always use one column.

## Reviewing changes

Review shows every changed file of the conversation's folder at once, paged ten
files at a time, and lets you keep or reject each change. What to compare,
Ignore whitespace, Viewed marks and the hunk buttons are described in
[Reviewing changes](./review.md).

Sending a PR question or suggested fix to the composer appends it after your
existing draft. It does not discard unfinished text or send automatically.

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

When GitHub reports a stack, the list shows that pull request's layer
(`3/16`). The detail view lists every layer with the stack base at the bottom.
**Merge stack** merges the open pull request you are reading and every open
layer below it, then GitHub rebases whatever remains. **Rebase stack** is
available on the top layer and updates remote branches without changing your
local checkout. Both ask for confirmation. A draft in the merge set, a stack
that changed since it was loaded, or GitHub.com not reporting stacks hides
those actions. Merging the current branch's pull request from the Review header
is unchanged.

### Work on a pull request

Hover a pull request in the list and choose **Work on this**, or choose **Work
on this PR** from the detail view's **···** menu. Pick where to check it out:

- **New worktree** (the default) fetches the pull request from `origin` into a
  separate branch and folder. The project folder is not touched.
- **Project folder** switches the project folder itself to the pull request. It
  refuses while the folder has uncommitted changes.

Capsule then opens a new conversation there with a draft naming the pull
request's number, title and link. Finish the sentence and send it.

When the pull request's branch lives in the same repository, the new branch
takes that name and tracks it, so a push updates the pull request. A pull
request from a fork gets a branch named `pr-<number>` with no upstream. If the
pull request no longer exists, or origin is not the repository it was opened
on, Capsule says so and creates nothing. Fetching uses Git, so it works even
where the GitHub CLI is not signed in, but the list itself needs it. A paired
browser cannot start this.

Filter the loaded list by title, author, branch, or PR number, and sort by recent
updates or creation time. The list shows up to 50 open pull requests. **Refresh**
asks GitHub for a new result. If a read fails, **Retry** tries again and any last
successful result stays visible; a connection failure is not shown as an empty
repository.

Repeated failed background reads back off. A rate-limit response pauses both
automatic reads and manual retries for at least a minute, increasing the delay
if the service keeps rejecting requests. Your last successful result stays visible.

Pull request watching uses the conversation's checkout, including its worktree,
and waits for an in-progress check before starting another. Stopping that
conversation's turn also stops its watch; late check results cannot start a repair
or merge. Repairs delivered to a new conversation use the same checkout, not a
fresh worktree. A worktree still used by another conversation is kept when you
delete its original conversation. Creating a new pull request explicitly starts a new watch when watching
is enabled. Turning watching off and back on also clears the stop.

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

After **Capture screenshot** in the browser, the notice offers **Attach to
message**, which adds the screenshot to the message you are writing.

To find text on the page, press `⌘F` while the browser has focus, or choose
**Find on page** from its menu. `Enter` goes to the next match, `⇧Enter` to the
previous one, and `Esc` closes the bar.
