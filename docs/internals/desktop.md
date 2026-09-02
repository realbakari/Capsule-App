# Desktop product spec

Keep this file in lockstep with the app. If you change a user-visible flow, update the matching section here in the same change. Architecture lives in [ARCHITECTURE.md](../../ARCHITECTURE.md). ACP harnesses live in [harness.md](harness.md).

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

- Five-column grid: chevron, pin, title, overflow (`···`), status. Project rows
  show a discovered or user-selected icon when one is available.
- Rows show the **project or thread name only**. Do not put folder paths under rows or in the titlebar.
- The sidebar titlebar carries a compact Capsule wordmark and hide control.
  Search, project, and thread rows are flat by default; hover supplies the
  surface and the active thread relies on text weight instead of stacked pills.
- Hide with the traffic-light-adjacent control or `⌘B`. Width animates to 0; do not `display: none` the sidebar or the swipe-back target disappears.
- Two-finger swipe left on the sidebar hides it. A rightward swipe or drag from the left edge shows it (`useSidebarSwipe`).
- `···` opens an in-app **portaled** action menu (the sidebar `backdrop-filter` creates a stacking context that traps `position: fixed` descendants). Right-click uses the native Electron menu (`capsule:showContextMenu`).
- Project menu: rename, new conversation, change folder, **add folder**, open folder, copy path, delete.
- Thread menu: rename, pin, generate title, open/copy folder when one exists, archive, delete.
- Pinned threads sort by `sessions.pin_order` (schema v9) and can be reordered
  with drag and drop. Unpinning clears the order value.
- The folder-plus control adds a local project. The adjacent Git control opens
  repository cloning; clone is delegated to `git clone -- <url> <destination>`
  with no shell, and a project row is inserted only after it succeeds.
- The titlebar exposes saved project actions, Open, Git branch state, and
  **Initialize Git** when the folder is not yet a repository.

---

## Folders

A project is one or more real folders.

| Role | Stored as | Used for |
|------|-----------|----------|
| Primary | `projects.workingDirectory` | cwd, git, AGENTS.md, new chats, ACP `--cwd` |
| Extra | `projects.extra_folders` JSON (schema v6) | Additional file access in Files / preview / read / write |
| Thread worktree | `sessions.working_directory`, `workspace_mode`, `worktree_branch` (schema v8) | Isolated cwd, git, files, commands, and ACP `--cwd` |
| Project icon | `projects.icon_path` (schema v9) | Optional custom local image; otherwise common project icon paths are discovered |

Helpers: `projectFolderList`, `addFolderToProject`, `removeFolderFromProject`, `makePrimaryFolder` in `@capsule/shared`.

- Inbox (`name === "Inbox"`) is the projectless container. Default disk root is `~/Documents/Capsule`, with a dated per-thread subfolder. `⌘O` on Inbox **creates a new project** rather than rewriting Inbox.
- Composer chip shows the folder **basename** and opens the native directory picker. Extra-folder management is the project `···` menu and the Inspector Files root chips — not a second path in the header.
- Engine file APIs take an optional `root` that must already be attached. Git stays on the primary folder.
- A worktree conversation uses its own folder as the active primary root. File
  picker (`⌘P`), `@` mentions, Inspector, Terminal, Git, saved actions, and ACP
  spawn all resolve against it. Extra project folders remain available.
- Worktree creation uses `git worktree add -b` below the app data directory.
  Switching modes is allowed only before messages, runs, or a live harness.
  Clean worktrees are removed with their conversation; dirty worktrees are
  retained and named in the engine log.

---

## Inspector

Opening the panel with no surface chosen shows the chooser: Review, Terminal,
Files, Browser and Side chat, each with what it opens and its shortcut. A
surface that cannot open is disabled and says why — "Available for Git
repositories", "Open a project first" — rather than being a control that does
nothing when clicked.

Tools: **Launch**, **Review**, **Terminal**, **Browser**, **Files**, **Side chat**.

- `+` opens Launch. Tabs are not nested buttons. Maximize, tree toggle, and close live in the chrome.
- **Files** is a split: preview on the left, expandable tree on the right. Folders expand **in place**. There is no navigate-into-directory / `← ..` stack and no `dir` current-path state.
- Click a file to preview it. Images render as `data:` URLs (`img-src 'self' data:`). Text is highlighted and can be edited with conflict-aware save. Binary files show a notice. Mention / Open / Edit live on the preview bar.
- Hidden tree names: `node_modules`, `.git`, `dist`, `out`, `.next`, `coverage`, `build`, `Pods`, `.DS_Store`.
- **Review** is git status, stage / discard / commit, diff, push, open-PR
  discovery, and PR creation via local `git` + `gh` when present. No GitHub
  OAuth. Pull-request rows open the canonical URL externally.
- **Terminal** is a command form (`execInProject`) plus “Open Terminal.app”. It is not a PTY or xterm.
- **Browser** polls `capsule:listLocalServers` while open. The filesystem adapter
  reads loopback listeners with `lsof`, performs bounded HTTP/HTTPS probes, and
  returns only endpoints that answer like web apps. Selecting one opens it in
  an isolated Electron guest with back, forward, reload, address, and an
  explicit external-browser escape hatch. Main process attachment policy strips
  preload, disables Node integration, requires context isolation + sandbox, and
  rejects non-HTTP(S) top-level navigation. The landing page keeps the eight
  most recently used addresses in renderer-local storage above live servers.
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

The composer is one box: the prompt, then a single row of the controls that
shape a turn — mode, permission, harness, and the context meter. The strip
below it is reference (folder, branch, terminal), not state. The steer field
appears only while a turn is running, which is the only time it means
anything. Permission options carry a line saying what each one does, because
"Supervised" does not say that it refuses rather than asks.

An empty conversation centers its project-aware heading and composer as one
unit. After the first turn, the composer returns to the bottom dock so the
transcript remains the primary reading surface.

For a selected coding harness, the composer shows its live readiness detail and
blocks send before spawn when the Gateway, acpx, folder, or CLI login is known
to be unavailable. Doctor and Harnesses are linked from that notice. A live ACP
session bypasses the spawn preflight.

Git projects expose **Local / Worktree** in the composer. The selected
conversation’s worktree branch appears in the reference strip.

The paperclip and file drop attach real local files, not only file mentions.
The filesystem adapter revalidates up to eight files at 50 MB each. Message
metadata is persisted as `messages.attachments` JSON (schema v9), while the
runtime prompt receives a clearly-delimited list of exact paths. An empty text
prompt is valid when at least one file is attached.

Unsent composer text and attachment metadata are saved in renderer-local
storage under a project/session-specific key. Prompt stash is also local: `⌘S`
stores the current draft, the bookmark restores or removes one of the 20 most
recent entries, and sending clears only the active draft. Stale paths are
reported by main-process validation when a restored draft is sent.

Usage lives in its own view, read from the CLIs' transcripts. It reports
tokens only — prices are not in the transcripts.

Replies render fenced code, headings, bullets, links, inline code and
GitHub-style pipe tables. A wide table scrolls inside the message rather than
widening the transcript column.

A running turn shows elapsed time, not just that it is running: a turn can go
for minutes and "working" alone gives no way to tell a slow one from a stuck
one. Activity rows carry an icon for the kind of work — command, read, edit,
reasoning — so a list can be skimmed without reading every label.

A folded turn shows how long it took beside its message count, and hovering it
previews the prompt and the start of the answer, so it can be identified
without unfolding. Activity rows
that failed render as an error in both the transcript and the inspector.

The composer footer shows how full the harness's context window is, read from
the `usage updated: <used>/<limit>` status frames the harness already sends.
It warns at 75% and turns critical at 90%; below that a meter people learn to
ignore is worse than none.

Each finished turn captures the worktree as a hidden Git ref under
`refs/capsule/checkpoints/<session>/turn/<n>`, so the changed-files card can
offer **Restore this turn**: the project folder goes back to how that turn left
it. Capture uses a throwaway index, so a half-staged change is untouched, and
writes a parentless commit that appears in no branch and no `git log`.


- Timeline of turns: user on the right, assistant markdown full-width, collapsed tool rows, a changed-files card that opens Review.
- Do not dump Artifacts or a second “run result” copy of the assistant reply.
- Composer: actual file attachments, `/` commands, `@` file mentions, `$`
  skills, prompt stash, permission profile, folder chip, Terminal.app.
- Mock runtime is first-class when the Gateway is down. It must never pretend it edited files. Prompt tokens: `[approval]`, `[fail]`, `[verify]`, `[multi]`, `[long]`, `[buzz]`, `[tool]`.

### Project actions

Saved actions live in `projects.project_actions` JSON (schema v8): id, name,
command, and optional preview URL. `capsule:runProjectAction` starts the command
through `@capsule/terminal` in the conversation cwd, keeps bounded combined
output in memory, and exposes explicit list / stop IPC channels. Process groups
are terminated on Stop, project or conversation deletion, and app shutdown.
The IPC remains a closed set; there is no renderer-facing generic shell beyond
the existing project command runner.

---

## Settings

Settings takes over the sidebar: the section list, a search box, and Back.
The panel shows one section with a `Settings / <Section>` breadcrumb and, for
sections that own settings, a **Restore defaults** control that resets only
that section. Keychain-backed tokens are never reset by it.

Settings sections use flat headings and separator rows. Cards are reserved for
status or content elsewhere in the product rather than wrapping every settings
group in another bordered box.

Searching the sidebar matches a setting's title or the words someone would
type instead — "dark" finds Theme, "squash" finds Merge method — and each
result names the section it lives in.

| Section | Owns |
|---------|------|
| General | Launch at login, send key, menu bar extra, keep awake, notifications, session archiving |
| Appearance | System / Light / Dark, per-theme accent / background / foreground, UI and code fonts, translucent sidebar, contrast, transcript size / width, with live type previews |
| Agents | Default mode, agent and conversation workspace, approval policy, sandbox, web access, output detail, reasoning, harness credentials |
| Gateway | URL, connect / disconnect, token in Keychain |
| Projects | Create, delete, attach primary folder, choose or reset project icon |
| Source control | Branch prefix, force-with-lease, draft PRs, merge method, review delivery, watch-and-fix, auto-merge, commit / PR instructions |
| Skills | skills.sh token for the catalog |
| Shortcuts | Editable key bindings — see below |
| Diagnostics | Process monitor, subsystem versions, export |
| About | App icon squircle, version, copyright, copy version info |

---

## Skills Directory

- **Packed skills and packs**: pre-bundled skills across Web & React, Backend & Database, Testing & Quality, Agent Workflows, and Design & UI.
- **Browse GitHub**: the directory reads a live catalog from the skill repositories on GitHub — names from the repository listing, descriptions from `SKILL.md` frontmatter. No account is needed. The catalog is cached on disk because unauthenticated GitHub allows 60 requests an hour for the whole machine; a failed refetch serves the last good page with the reason attached rather than an empty list. Refresh forces a refetch.
- **skills.sh**: optional. Every skills.sh endpoint answers 401 without a Vercel OIDC token, so the catalog reads GitHub unless a token is set in Settings → Skills. With one, skills.sh results merge in ahead of the GitHub ones and carry install counts.
- **Installing** fetches the skill's `SKILL.md` and stores it. A skill without that text is refused rather than saved, because a turn injects the active skill as `[Active Skill: name]` followed by its content — a skill stored without content attaches and contributes nothing.
- **Composer attachment**: type `$skill` in the composer to attach procedural guidance to a run.

Permissions are Capsule-native and mapped onto Gateway acpx (see [harness.md](harness.md)):

- Standard / Full access → `permissionMode=approve-all`
- Supervised → `deny-all` (refuse; never fake a prompt)
- Capsule Approvals only if OpenClaw forwards `session/request_permission`

---

## Global shortcuts

Shortcuts are declared once, in `apps/desktop/src/renderer/src/lib/keybindings.ts`,
which is both the handler's dispatch table and the Settings list. Renderer
commands can be rebound in Settings → Shortcuts by pressing the keys; a rebind
that would take another command's keys is refused. Commands marked *menu* are
declared by the application menu in the main process, which receives the key
before the web contents does, so they are shown but not editable.

| Action | Keys | |
|--------|------|---|
| Settings | `⌘,` | menu |
| Command palette | `⌘K` | menu |
| New conversation | `⌘N` | menu |
| Open / attach folder | `⌘O` | menu |
| Mention files from disk | `⇧⌘O` | menu |
| Search files to mention | `⌘P` | rebindable |
| Search in files | `⇧⌘F` | rebindable |
| Toggle sidebar | `⌘B` | rebindable |
| Toggle inspector | `⌘\` | rebindable |
| Stash prompt | `⌘S` | composer-local |
| Send | Enter or `⌘Enter` per Settings | |

---

## What this app does not include

- Monaco, xterm, or an in-app PTY
- Embedded browser / webview
- Capsule-owned ACP JSON-RPC server or bundled Claude Agent SDK
- GitHub OAuth (local `git` + `gh` only)
- Messaging-channel protocols (Gateway owns those)

When a limitation is lifted, delete it here and in ARCHITECTURE.md §9 in the same change.
