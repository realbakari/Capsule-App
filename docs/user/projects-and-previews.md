# Projects, actions, and local previews

The titlebar keeps common project setup close to the conversation.

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
copy. Starting an agent and changing its working directory both use this alias.

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

## Pull requests

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
diffs, collapse a file, or collapse and expand them all. **Summary** renders
comment Markdown and lists checks with links to their output.
Code is syntax-coloured, and long lines wrap by default while keeping both sides
aligned. Turn **Wrap lines** off to scroll horizontally instead. File headers
remain compact when collapsed.
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
