# Desktop product spec

Keep this file in lockstep with the app. If you change a user-visible flow, update the matching section here in the same change. Architecture lives in [ARCHITECTURE.md](../ARCHITECTURE.md). ACP harnesses live in [harness.md](harness.md).

Capsule is a workspace, not a clone of any other agent product. Quality bars elsewhere are allowed; product copy, comments, and docs must not name those products.

---

## Shell

```
┌ Sidebar ┐┌ Titlebar ──────────────────────────────── Inspector toggle ┐
│         │├ Conversation / other views ┐┌ Inspector (optional)        ┤
│ Projects││ Transcript                 ││ Launcher / Files / Review … │
│ Threads ││ Composer dock              ││                             │
└─────────┘└────────────────────────────┴──────────────────────────────┘
```

- Graphite and off-white. No purple. No app mark in the titlebar.
- 52px titlebar is an Electron drag region. Interactive controls must be **no-drag children of the titlebar**, not `position: fixed` overlays. Fixed siblings are swallowed by `-webkit-app-region: drag`.
- Centered chat column. Glass composer dock. Inspector closed until opened (`⌘\`, `/inspect`, or the titlebar control). Width persists as `capsule.inspectorWidth`.

---

## Sidebar

- Five-column grid: chevron, pin, title, overflow (`···`), status.
- Rows show the **project or thread name only**. Do not put folder paths under rows or in the titlebar.
- Hide with the traffic-light-adjacent control or `⌘B`. Width animates to 0; do not `display: none` the sidebar or the swipe-back target disappears.
- Two-finger swipe left on the sidebar hides it. A rightward swipe or drag from the left edge shows it (`useSidebarSwipe`).
- `···` opens an in-app **portaled** action menu (the sidebar `backdrop-filter` creates a stacking context that traps `position: fixed` descendants). Right-click uses the native Electron menu (`capsule:showContextMenu`).
- Project menu: rename, new conversation, change folder, **add folder**, open folder, copy path, delete.
- Thread menu: rename, pin, generate title, open/copy folder when one exists, archive, delete.

---

## Folders

A project is one or more real folders.

| Role | Stored as | Used for |
|------|-----------|----------|
| Primary | `projects.workingDirectory` | cwd, git, AGENTS.md, new chats, ACP `--cwd` |
| Extra | `projects.extra_folders` JSON (schema v6) | Additional file access in Files / preview / read / write |

Helpers: `projectFolderList`, `addFolderToProject`, `removeFolderFromProject`, `makePrimaryFolder` in `@capsule/shared`.

- Inbox (`name === "Inbox"`) is the projectless container. Default disk root is `~/Documents/Capsule`, with a dated per-thread subfolder. `⌘O` on Inbox **creates a new project** rather than rewriting Inbox.
- Composer chip shows the folder **basename** and opens the native directory picker. Extra-folder management is the project `···` menu and the Inspector Files root chips — not a second path in the header.
- Engine file APIs take an optional `root` that must already be attached. Git stays on the primary folder.
- File picker (`⌘P`) and `@` mentions search the **primary** folder. Inspector filter search uses the **active** Files root (primary or extra).

---

## Inspector

Tools: **Launch**, **Review**, **Terminal**, **Browser**, **Files**, **Side chat**.

- `+` opens Launch. Tabs are not nested buttons. Maximize, tree toggle, and close live in the chrome.
- **Files** is a split: preview on the left, expandable tree on the right. Folders expand **in place**. There is no navigate-into-directory / `← ..` stack and no `dir` current-path state.
- Click a file to preview it. Images render as `data:` URLs (`img-src 'self' data:`). Text is highlighted and can be edited with conflict-aware save. Binary files show a notice. Mention / Open / Edit live on the preview bar.
- Hidden tree names: `node_modules`, `.git`, `dist`, `out`, `.next`, `coverage`, `build`, `Pods`, `.DS_Store`.
- **Review** is git status, stage / discard / commit, diff, push, and PR via local `git` + `gh` when present. No GitHub OAuth.
- **Terminal** is a command form (`execInProject`) plus “Open Terminal.app”. It is not a PTY or xterm.
- **Browser** opens URLs with `shell.openExternal`. It is not an embedded webview.
- **Side chat** lists ACP harnesses and live sessions (spawn / cancel / close).

Inspector-only shortcuts (ignored while typing, do not steal global `⌘P`):

| Action | Keys |
|--------|------|
| Review | `⌃⇧G` |
| Terminal | `⌃\`` |
| Side chat | `⌥⌘S` |
| Close / toggle inspector | `⌘\` |

A panel crash is isolated by `ViewErrorBoundary`. Retry remounts the panel. Fast Refresh that replaces the child component type, or a change to `INSPECTOR_REVISION`, clears a stuck error.

---

## Chat

- Timeline of turns: user on the right, assistant markdown full-width, collapsed tool rows, a changed-files card that opens Review.
- Do not dump Artifacts or a second “run result” copy of the assistant reply.
- Composer: `/` commands, `@` file mentions, `$` skills, permission profile, folder chip, Terminal.app.
- Mock runtime is first-class when the Gateway is down. It must never pretend it edited files. Prompt tokens: `[approval]`, `[fail]`, `[verify]`, `[multi]`, `[long]`, `[buzz]`, `[tool]`.

---

## Settings

| Tab | Owns |
|-----|------|
| General | Send key, default mode, mock scenario |
| Appearance | System / Light / Dark, per-theme accent / background / foreground, UI and code fonts, translucent sidebar, contrast, transcript size / width |
| Configuration | Default permission, sandbox, web access, output detail, reasoning, notifications, desktop, sessions, browser, git/PR (branch prefix, merge method, force-with-lease, draft PRs, review delivery, watch-and-fix, auto-merge, commit/PR instructions) |
| Gateway | URL, connect / disconnect, token in Keychain |
| Projects | Create, delete, attach primary folder |
| Shortcuts | The table below |
| Diagnostics | Subsystem versions, export |

Permissions are Capsule-native and mapped onto Gateway acpx (see [harness.md](harness.md)):

- Standard / Full access → `permissionMode=approve-all`
- Supervised → `deny-all` (refuse; never fake a prompt)
- Capsule Approvals only if OpenClaw forwards `session/request_permission`

---

## Global shortcuts

| Action | Keys |
|--------|------|
| Settings | `⌘,` |
| Command palette | `⌘K` |
| New conversation | `⌘N` |
| Open / attach folder | `⌘O` |
| Mention files from disk | `⇧⌘O` |
| Search files to mention | `⌘P` |
| Search in files | `⇧⌘F` |
| Toggle sidebar | `⌘B` |
| Toggle inspector | `⌘\` |
| Send | Enter or `⌘Enter` per Settings |

---

## What this app does not include

- Monaco, xterm, or an in-app PTY
- Embedded browser / webview
- Capsule-owned ACP JSON-RPC server or bundled Claude Agent SDK
- GitHub OAuth (local `git` + `gh` only)
- Messaging-channel protocols (Gateway owns those)

When a limitation is lifted, delete it here and in ARCHITECTURE.md §9 in the same change.
