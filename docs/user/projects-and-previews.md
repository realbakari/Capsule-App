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
toolbar supports back, forward, reload, returning to local servers, and opening
the current page in your system browser when you need it there. The Browser
home keeps the eight most recently used pages above the live-server list.

## Pull requests

The Review panel lists open pull requests for the selected repository when the
GitHub CLI is installed and signed in. Select one to open it in your browser.
The same panel still owns changed files, commits, push, and creating a draft or
ready pull request for the current branch.
