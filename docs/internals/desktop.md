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
- A persisted failed turn owns its inline error. A normalized duplicate IPC
  notice is suppressed at the top, including after dismissal. Notice-only
  failures and unrelated notices remain visible. Dismissal keys include the
  thread, run, and error so a later attempt is not silently dismissed. Failed
  sends keep their existing draft/attachment recovery. Exact cancellation
  acknowledgements are filtered from displayed history without deleting records.
- At narrow widths, titlebar actions shrink before the project/thread breadcrumb;
  composer controls wrap inside their own row instead of overlapping Attach or
  Send.

---

## Sidebar

- Five-column grid: chevron, pin, title, overflow (`···`), status. Project rows
  show a discovered or user-selected icon when one is available.
- Rows show the **project or thread name only**. Do not put folder paths under rows or in the titlebar.
- The sidebar titlebar carries a compact Capsule wordmark and hide control.
  Search, project, and thread rows are flat by default; hover supplies the
  surface and the active thread relies on text weight instead of stacked pills.
- Hide with the traffic-light-adjacent control or `⌘B`. Width animates to 0; do not `display: none` the sidebar or the swipe-back target disappears.
- Both normal and Settings sidebars are `inert` while collapsed. Close any
  portaled menu and transfer focus to the visible titlebar toggle when needed.
  Thread-row keyboard handlers ignore events from nested action buttons.
- A project-name search retains that project's active conversations. A
  thread-name search filters its children instead of implying the project is empty.
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

Project and thread paths containing spaces remain unchanged in the UI. Local
Gateway spawn uses a private alias internally; live cwd tuning is refused by
the engine instead of mutating the project while a thread is bound. Local spawn
does not tell the user to move the project. Remote Gateway errors explain
the need for a host-side path/alias without changing the selected runtime route.

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
Files, Browser, Agents and Side chat, each with what it opens and its shortcut. A
surface that cannot open is disabled and says why — "Available for Git
repositories", "Open a project first" — rather than being a control that does
nothing when clicked.

Tools: **Launch**, **Review**, **Terminal**, **Browser**, **Files**, **Agents**, **Side chat**.

- `+` opens Launch. Tabs are not nested buttons. Maximize, tree toggle, and close live in the chrome.
- **Files** is a split: preview on the left, expandable tree on the right. Folders expand **in place**. There is no navigate-into-directory / `← ..` stack and no `dir` current-path state.
- Click a file to preview it. Images render as `data:` URLs (`img-src 'self' data:`). Text is highlighted and can be edited with conflict-aware save. Binary files show a notice. Mention / Open / Edit live on the preview bar.
- Hidden tree names: `node_modules`, `.git`, `dist`, `out`, `.next`, `coverage`, `build`, `Pods`, `.DS_Store`.
- **Review** is git status, stage / discard / commit, diff, push, open-PR
  discovery, and PR creation via local `git` + `gh` when present. No GitHub
  OAuth. Selecting a pull request keeps the reader in Capsule and opens its
  **Summary / Timeline / Code** views. Summary contains review metadata and the
  Markdown description, Timeline interleaves commits, comments, and reviews,
  and Code shows file stats plus the host patch. **Open on GitHub** moves the
  canonical URL into Capsule's Browser surface.
  The list has local title/author/branch/number filtering, update/creation sorting,
  and a refresh that bypasses the two-minute cache. It loads up to 50 open PRs;
  filters are explicitly scoped to those loaded results. Listing reads omit the
  heavyweight check rollup; individual checks load in the detail view.
  Empty or malformed JSON is a failed read, not an empty list. Idempotent JSON
  reads retry incomplete responses and transient 502/503/504 failures once within
  one timeout budget. Writes are never automatically retried. Failed refreshes
  retain the last successful result and show an actionable error with Retry.
  Code's commit selector uses the read-scoped `getCommitDiff` IPC, a validated
  full SHA, and `gh api` in the thread's checkout. It does not switch branches.
  Both full-PR and single-commit diffs support split/unified display and working
  individual/all-file collapse controls. The existing bounded React-node highlighter
  colours code, and long lines wrap by default. One file-wide CSS grid keeps split
  counterparts aligned; disabling Wrap lines restores horizontal scrolling. File
  headers use flat separators and tabs use one segmented control. Line notes are available only for the
  full PR and retain old/new-side coordinates in an in-panel editor.
  Review notes and comment drafts can be copied or placed into the thread
  composer; they do not post, approve, or request changes on GitHub. Check links
  open in Capsule's Browser. These reads work independently of the runtime route
  or selected harness and remain available to the read-only remote viewer.
  Summary, comments, and Timeline use the same host-Markdown normalization:
  hidden HTML comments disappear, presentation tags become text, and HTML/image
  badges become labelled HTTP(S) links. No untrusted HTML is injected and no
  remote image is fetched by the renderer. Fenced and inline code remain literal.
  Balanced details/summary blocks become native expandable sections; their attributes
  are discarded, nested sections are bounded to 12 levels, and code/comment ranges
  are excluded from structure parsing. Backtick and tilde code fences preserve
  shorter fences inside examples. Markdown tables scroll within the body.
  Summary comments are collapsible cards with shared newest/oldest ordering.
  Timeline groups adjacent comments/reviews without grouping across a commit;
  commit titles open the single-commit diff. Optional mergedAt/closedAt fields
  supply lifecycle events; updatedAt is never used to fabricate their timestamps.
  Thread-resolution state is not fetched or inferred; collapsed is not resolved.
  Timeline avatars sit on the event rail beside the author; heading contrast,
  wrapping and type scale are scoped to the PR reader rather than chat.
- **Terminal** in the Inspector is a command form (`execInProject`) plus “Open Terminal.app”. The separate xterm dock is an interactive PTY. `PersistentTerminals` retains panes by folder; the chat host stays mounted but hidden in other views. Hide and Settings do not kill shells; closing a pane or quitting does. Main checks strict command policy on start and input, not just on the command runner. Existing processes are not retroactively stopped. PTYs hold a folder activity lease until exit, excluding checkpoint restore.
- **Browser** polls `capsule:listLocalServers` while open. The filesystem adapter
  reads loopback listeners with `lsof`, performs bounded HTTP/HTTPS probes, and
  returns only endpoints that answer like web apps. Selecting one opens it in
  an isolated Electron guest with back, forward, reload, address bar with search
  normalization, interactive DOM element inspection, viewport screenshot capture
  to clipboard, system-browser launch, and an options menu offering hard reload,
  DevTools, zoom controls, and cache/cookie clearing. Main process attachment policy
  strips preload, disables Node integration, requires context isolation + sandbox,
  and rejects non-HTTP(S) top-level navigation. The landing page keeps recently
  used addresses in renderer-local storage above live servers.
  Committed main-frame navigation updates the address and external-open target
  without resetting guest `src`. Main forces `persist:capsule-browser` on guest
  attachment, tracks guest ownership, and limits clear-data IPC to owned guests.
  Cache/storage clearing awaits the isolated Electron session operation;
  application drafts/preferences are not touched. Clear-data and registration
  are write-scoped for paired viewers.
  Screenshot copying uses the write-scoped `copyBrowserScreenshot` IPC, limited
  to registered owned guests. Main captures a NativeImage and writes image pixels
  to Electron's clipboard; capture failures never become text/data-URL fallback.
  Discovery polling is single-flight while mounted, retains the last good list
  on failure, and provides a retry. Guest registration failures are visible;
  subframe and aborted-load errors do not replace the main page. The direct
  browser navigation tool can request the first guest through `open-browser`;
  registration completes the request with a ten-second readiness timeout.
  The first page is not reloaded after registration. Gateway browser tools are
  not injected; see [harness.md](harness.md).
  Browser addresses retain at most 20 thread/project entries in memory. The
  inspector remounts the guest across owners; history entries validate URL,
  timestamp and size before rendering and strip embedded credentials.
  Public schemeless addresses default to HTTPS, loopback to HTTP. Toolbar controls
  are DOM-ready-gated, wrap at narrow widths, offer recoverable crash/load errors
  and provide fill/390px/768px preview widths (not device emulation).
  Agent control is opt-in for the visible thread, revoked on hide/unmount or
  leaving Chat, and never available in the paired viewer. Main routes first-open
  readiness by thread identity. Per-process tokens, isolated-world element refs,
  bounded interaction/screenshot/diagnostic tools and transport rules are described
  in [harness.md](harness.md#embedded-browser-tools). Permission handlers deny device
  and clipboard access; downloads and dialogs are disabled. Storage still belongs
  to the shared foreground browser partition, not a per-thread browser profile.
  A **Page control off/on** toolbar disclosure contains permission details and the
  background-page controls in an out-of-flow, bounded popover. Opening it does
  not reduce page height; Escape and outside clicks dismiss it. Background
  polling pauses while its parent disclosure is closed.
  **Background page** is a collapsed disclosure for explicitly starting a separate
  temporary page from the address bar. Agent access and remote sharing are separate
  switches; close is always available, including after failure. Pages survive panel
  switches, but not their 30-minute expiry, thread archive/delete or app shutdown.
  Close disposes the isolated profile's storage and connections.
  Background subresources permit WebSockets; main-frame navigation remains
  HTTP(S)-only. Grants require a direct thread and a concrete harness identity.
  Update restart
  admission asks the user to close background pages. Dock activation tests the
  main workspace window, not the count of hidden/companion windows. The paired viewer gets
  read-only, explicitly shared snapshots here, not a webview or write channel.
- File editors capture immutable project/root/path and their own revision cell.
  Navigating flushes pending changes to that owner; late preview/listing reads
  are rejected after selection changes. Old save replies do not update a new
  document's revision or UI.
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

HTTP and HTTPS links in rendered Markdown open the Inspector's embedded Browser
surface. Non-web schemes keep the platform handler fallback.

For a selected coding harness, the composer shows its live readiness detail and
blocks send before spawn when the selected route, folder, or CLI login is known
to be unavailable. Doctor and Harnesses are linked from that notice. A live ACP
session bypasses the spawn preflight.
Direct readiness does not require Gateway/acpx. Harnesses and the composer use
the same route decision. Engine admission and renderer submission guards refuse
overlapping turns. Steer is shown only for active Gateway turns, never merely
while a send is awaiting acknowledgement. Send-and-new-thread advances only on
acceptance; read/refresh failure after acceptance cannot recreate the sent draft.
Direct permissions become persisted approvals with approve-once/deny callbacks;
session-wide approval is refused. Completion, Stop, Close, and output-budget
failure cancel pending requests rather than recording a user denial. Cancelled
approvals leave both the conversation and Approvals queue; late decisions cannot
reopen them. Unsupported live options fail before local persistence and their
errors reach the UI.

Capability details use the current session key as well as the thread ID. A
direct agent reporting false or no HTTP MCP support shows browser tools as
unavailable, explains why they were not attached, and preserves manual browsing.
Model configuration snapshots replace previous choices, including removals.
**Agent settings** renders reported select and boolean options in both Composer
Capabilities and Harnesses. Values wait for agent acknowledgement, and failure
of either the setting or follow-up refresh must release the pending UI. Provider/
process changes remount the controls. Restorable direct identities also govern
composer readiness after restart, even if the new-thread default is Gateway.
The compact capabilities popover wraps both availability and settings in one
bounded scrolling surface; nested disclosures do not expand the composer toolbar.

Git projects expose **Local / Worktree** in the composer. The selected
conversation’s worktree branch appears in the reference strip.

The paperclip and file drop attach real local files, not only file mentions.
The filesystem adapter revalidates up to eight files at 50 MB each. Message
metadata is persisted as `messages.attachments` JSON (schema v9), while the
runtime prompt receives a clearly-delimited list of exact paths. An empty text
prompt is valid when at least one file is attached.
Direct delivery additionally materializes negotiated native image and embedded
text/blob blocks with lower protocol bounds (2 MiB/file, about 3 MiB raw total,
4 MiB encoded request). The general attachment-picker limit is not the transport
limit. Failing direct delivery produces an explicit failed run. No binary prompt
copies are stored in SQLite. See [harness.md](harness.md#direct-sessions).
Paste/drop paths come from Electron `webUtils.getPathForFile` through the
preload, not the removed `File.path` property. Remote attachment attempts show
a desktop-only error and cannot invoke the host file picker or send.

Unsent composer text and attachment metadata are saved in renderer-local
storage under a project/session-specific key. Prompt stash is also local: `⌘S`
stores the current draft, the bookmark restores or removes one of the 20 most
recent entries, and sending clears only the active draft. Stale paths are
reported by main-process validation when a restored draft is sent.

Usage lives in its own view, read from the CLIs' transcripts. It reports
tokens only — prices are not in the transcripts.

The composer uses one agent/model picker with grouped, capability-aware choices.
Permission and conversation mode controls collapse into an overflow menu below
36rem of available row width, along with stash and the Harnesses link. The agent,
attachment and send controls stay visible. Folder, terminal, workspace mode and
branch sit in an inset context strip beneath the prompt. Menus keep sentence
case. Git workspace selection includes the folder chooser, and its label and
the branch label collapse to named, tooltip-equipped icons below 28rem.
Menus clamp to the viewport,
support arrow/Home/End keys and restore trigger
focus on selection or Escape. Unavailable rows remain readable without dispatch.

Run activity distinguishes submission, running, pending cancellation, failure and
completion. The renderer deduplicates cancellation requests per run and shows
Stopping until that request settles; this is transient window state, not a
persisted runtime status. Verified requires a passing check whose evidence belongs
to the displayed run. Merely folding a finished work log never earns a success
badge. Raw run events and session diagnostics remain expandable.
Touched-file chips are separate keyboard-operable buttons below the disclosure
header, wrapping inside the card rather than overflowing the activity row.

The desktop companion is a separate transparent, initially inactive window,
available from General settings, the palette and the app menu. Its two-piece
off-white/graphite capsule SVG uses gradient shading and independent CSS tracks
for breathing, head tilt, floating, looking around, blinking, arm articulation,
shadow and working-state core rotation, plus coordinated greet/roll/bounce
reactions. The glyph, caption and colour carry state without relying on motion.
A dedicated SVG drag handle leaves the mascot keyboard/click accessible.
The window expands upward for the tray, clamped to its display's work area.
Pointer gaze follows both axes without a JS frame loop. Greet changes expression
and waves one arm. Size/pause preferences are renderer-local; reduced motion and
hidden-window visibility disable animation.
Hidden-renderer regressions explicitly emulate both reduced motion and no
preference in Chromium's CSS engine, independent of the host's accessibility
settings. They check actual transform changes, greet/roll/bounce reactions, pause/resume and
tray navigation in both modes; reduced motion must keep every part still.
Activity reads coalesce at 250ms with only one outstanding request; tool-output
frames do not trigger reads. An indexed lookup selects each non-archived thread's
newest run state without loading historical prompts, results or verification JSON.
Only that newest run contributes to attention; errors never imply idle success.
Read-only remote viewers can query pet state but cannot toggle or resize it.

Review search uses a scoped search-field surface rather than native browser
input chrome. Search/sort and commit controls share a 2.25rem minimum height;
branch actions wrap on narrow panels. The commit form owns its draft, admits
one submission at a time and clears only after success. Its workspace key
prevents a previous folder's response from clearing another draft. PR actions
use the shared SVG icon set and portaled, keyboard-dismissable popover; clipboard
success is reported only after the write resolves. Harness catalog rows expose
selection through a check, border and aria-pressed, distinct from hover. Sidebar
icon slots remain flex-centered instead of being overwritten by SVG block rules.

Diagnostics exposes bounded process-local timings: 200 recent samples, 20
slowest, and fixed-label aggregates for event handling, Git process/queue time
and local preview reads. Samples contain no paths, prompts, output or arguments;
export is explicit. Event timing excludes browser paint and agent latency.
Non-zero Git probes count as failures even when absence is expected. Host and
renderer timings are separate; this is diagnostic evidence, not freeze prevention.

Replies render fenced code, headings, bullets, links, inline code and
GitHub-style pipe tables. A wide table scrolls inside the message rather than
widening the transcript column.

A running turn shows elapsed time, not just that it is running: a turn can go
for minutes and "working" alone gives no way to tell a slow one from a stuck
one. Activity rows carry an icon for the kind of work — command, read, edit,
reasoning — so a list can be skimmed without reading every label. Turns that
touch, create, or modify files surface interactive file chips (`[+] Created`,
`[~] Modified`, `[-] Deleted`) directly in the run summary and `TurnFilesCard`,
linking immediately to file previews or diffs in the Inspector.

A folded turn shows how long it took beside its message count, and hovering it
previews the prompt and the start of the answer, so it can be identified
without unfolding. Activity rows
that failed render as an error in both the transcript and the inspector.

The composer footer shows how full the harness's context window is, read from
the `usage updated: <used>/<limit>` status frames the harness already sends.
It warns at 75% and turns critical at 90%; below that a meter people learn to
ignore is worse than none.

Each finished turn captures the worktree as a hidden Git ref under
`refs/capsule/checkpoints/<session>/turn/0/<run-id>` (legacy refs use a turn number), so the changed-files card can
offer **Restore this turn**: the project folder goes back to how that turn left
it. Capture uses a throwaway index, so a half-staged change is untouched, and
writes a parentless commit that appears in no branch and no `git log`.
Restore also uses a private index (`git restore --worktree`), preserving the
real staging area. Canonical folder activity excludes admitted turns, active
runs, checks, saved actions and PTYs during restore, including overlapping parent
and nested project folders and aliases. New local writes are
refused while restoring. This is not a lock on external editors or processes.

Changed-files outcomes are mounted inside their owning transcript turn, keyed
by session/run/checkpoint, rather than in a conversation footer. New prompts
persist their `runId`; legacy history uses explicit reply run ids or an
unambiguous matching prompt/time window. Project and session scope are checked
before rendering, and folded turns unmount their outcome until reopened.
The in-flight work log uses only the active run's events, never an older
checkpoint or Git status counts. Completed outcomes load their own saved diff;
a successful empty diff does not fall back to events. When no pair of saved
snapshots exists, only that run's write events may provide a file list, without
borrowing current worktree counts. The raw checkpoint-to-worktree helper is
not a turn-diff fallback. Restore targets the card's own run after confirmation,
and the card expands its immutable saved diff in place. Current-file discard
stays in Review, not on a historical card.

### Saved-file previews and turn details

Finished-file rows open an ephemeral saved-diff preview on hover or focus.
`TurnOutcome` initially requests only the saved file summary. Hover/focus and
file selection request the owning checkpoint pair through `turnDiff` with a
literal relative path, never current repository status or live file contents.
The filesystem adapter caps each patch at 512 KiB and metadata commands at
1 MiB, stops its Git child at the output limit, and keeps complete records only.
The list is capped at 2,000 files; omitted rows/counts and partial patches are
explicit. Unknown/binary line counts stay absent. `SavedDiffPreview` scans
file boundaries for an exact current or
renamed path and parses only a bounded prefix (48,000 characters, 84 patch
lines, 600 displayed characters per code line). Numstat counts come from
the saved outcome, not the excerpt. Binary, metadata-only and missing text
states are explicit. One portal per card stays within the viewport, supports
pointer traversal, keyboard focus/Down Arrow and Escape, and is disposed when
the owning snapshot changes. Selecting a file opens that file's paged saved
diff; the bounded all-files view remains available. These reads use the existing
read-only turnDiff channel on both runtime routes and paired viewers. Late
responses are discarded after owner changes; no unbounded patch cache is kept.

Sent image attachments use `messageImage(messageId, index)`, a read-only channel
whose source path comes only from persisted attachments. The engine reopens a
regular, non-symlink file with a 20 MiB read limit. Main returns at most a
320×180 raster thumbnail / 128 KiB data URI, never the original full image over
IPC. Nearby message rows request it lazily and discard it on unmount. Missing or
undecodable files retain an explicit fallback and open action.

Conversation activity, paged diagnostics and verification share one
`RunSummary` expansion per run. The collapsed summary still reports the actual
run/check state. Details mount on first expansion and remain hidden rather
than unmounting on collapse, preserving in-progress checks and form inputs.
The summary is keyed to its run so those details cannot follow a new turn.
Gateway recovery appears once inside the composer, following the selected
runtime route (including an existing thread's pinned route). It is absent for
direct agents and the mock runtime. Connection errors are caught inline with
retry, while distinct folder, login and installation blockers remain visible.

### Verification receipts and workspace ownership

Completed turns and History render the same collapsed `TurnVerification`
disclosure. It lists saved project actions from the run's project, shows the
command before explicit execution, and supports cancel, rerun, and evidence-only
recheck only when a receipt exists. **Add check** saves an action on that owning
project through the existing `updateProject` IPC; it never executes on save.
The only action is preselected, never automatically run. Cwd, hashes and
requirement guidance sit inside **Evidence details**. Receipts share the owning
turn's activity expansion with its work log.
A completed turn with neither a saved reply nor result shows a missing-reply
notice. ACP activity counts deduplicate updates by run plus tool call id, while
retaining failure status and the latest readable detail. Completion and verification are independent: prose and custom
requirements never produce an objective pass. Missing evidence is unverified,
not a failed agent run. The receipt is explicitly local-only for both routes.

Migration 12 persists `working_directory`, `revision` (cwd, HEAD, tree), and
`verification` on runs. Capture uses asynchronous Git with a temporary index.
Follow-up sends wait for a pending capture in that cwd. Revision checks reject
newer work before starting a saved action and compare again after it exits.
The check holds the repository queue, records bounded output, and is cancelled
on shutdown. The pending receipt is unverified, so interrupted checks do not
become passes on restart. `verifyRun` and `cancelVerification` are write IPC;
read-only viewers can read receipts through run records but cannot execute.

Renderer state is owned by a selection token containing project, thread and
resolved folder. Scoped setters reject old responses even after A → B → A.
Git, messages, older pages and global run refreshes also use request versions:
an earlier response cannot replace a newer result. Notices, confirmations and
draft setters cannot spill into another selection.

Native Git status, diff, checkpoint and worktree helpers run asynchronously.
`inRepository` serializes composite operations by canonical Git common
directory, including linked worktrees. Concurrent identical reads share one
answer; a queued write invalidates that sharing before a later read. There is
no time-based cache of Git status. A composite push/create-PR operation keeps
its lock through both steps. External Git processes are not governed by this
queue; Git's own locking and pre/post revision checks remain necessary.

File indexing uses asynchronous Git reads with a shared in-flight scan and a
30-second cache. Invalidation prevents older scans from repopulating the cache.
Content search uses the thread's owned cwd and filesystem-read policy; it reads
four files at once, at most 400 KB each, excludes binary and escaping symlink
targets, and retains at most three hits per file and sixty overall. A failed
repository listing does not fall back to a walk that bypasses its ignore rules.
The Files pane memoizes roots, sorting and indexed Git marks; editor keystrokes
do not rebuild the tree. Content-search results open the selected preview.

The shared run channel carries both run records and run events. Live events
include an optional session routing hint; older stored events remain scoped by
the requested run. The renderer batches at 50 ms or 128 frames, flushing terminal
records immediately. It merges frames by ID instead of re-reading workspace,
messages and event history per frame. Completed records refresh artifacts only.
Snapshot reads reconcile with frames received during the read; older loaded
message pages survive reconnects. Both runtime routes feed this same path.

Live run events are retained in a window of at most 1,000 records and 2 MB.
`listRunEventPage` is a named read-only IPC channel: 200 events per page, moving
backwards by timestamp and insertion-order cursor. The database bounds legacy
message/data columns before JSON decoding. New diagnostic payloads are compacted
before persistence and publication (8,192 message characters; bounded data
strings, depth, entries and nodes). This does not truncate authoritative agent
replies or replace artifacts. Truncation and earlier-history markers are visible;
recent activity counts must not be presented as whole-run totals. Each turn has
a lazy, replace-in-place Run log, including failed runs. Event-only file evidence
uses the recent page and discloses incompleteness instead of loading entire runs.

Failed sends use draft revisions as well as selection ownership. If typing or
attachment changes occurred after submission, preserve the new draft and stash
the failed prompt separately. The demo bridge implements the paged log too.

Diff rendering is explicitly paged, not virtualized: ten files per list page
and 160 rows per expanded file, with a 640-line initial expansion budget.
Collapsed files do not prepare or highlight their bodies. Split pairs and
review-note line/side references retain their original coordinates across pages.
Raw diff previews also page at 160 lines. Saved-diff reads that fail or lose a
required checkpoint throw actionable errors rather than returning an empty patch;
the turn outcome offers Retry without substituting current repository changes.

Git porcelain and numstat use NUL separators; renames and quoted UTF-8 paths
remain exact. File operations use literal pathspecs. Hunk lines are consumed by
their declared counts before interpreting headers, so SQL `--` and `++` lines
cannot become file headers. Current review combines HEAD-to-worktree changes
with untracked-file patches (or staged/new files before the first commit).
More than 200 new files or a combined patch over 16 MB requires individual
review. PR cache identity includes checkout, branch, refs and remotes; stale
background results cannot repopulate another identity. Merge revalidates the
current branch's PR and passes its explicit URL to the GitHub CLI.

Browser attachment effects follow the mounted guest, not its initial URL.
Home-to-same-address navigation reconnects listeners and tool registration.
HTTP(S) popup requests load in that guest; other schemes are denied and never
forwarded to the system browser. Popup enablement is a string attribute because
React drops a boolean on the custom element. Browser snapshots independently
bound text, titles, links and labels in guest and main, with a 96 KB UTF-8 result
limit and visible truncation. Password values remain excluded.

Preview reads use an asynchronous nonblocking descriptor, validate that it is a
regular file, check image/text size limits before allocation, and bound reads
against growth. Save conflict checks fail closed if the original revision can
no longer be read. Local action stop retains process ownership and folder lease
through `stopping` until exit, with TERM-to-KILL escalation on its owned group.
Late callbacks cannot remove a replacement action's handle.

Remote-access transitions are serialized and generation-checked; a superseded
start is stopped before its handle is exposed. Stop failure retains ownership
and reports the actual listener state. Reset defaults uses the normal engine
settings path and awaited desktop side effects, not just database persistence.
Both Gateway and catalog tokens are excluded from settings serialization;
legacy copies migrate to the secret store before their database keys are removed.

The desktop pins Electron 43.4.1. Native SQLite and terminal modules must be
rebuilt for this runtime; renderer and startup fixtures use isolated profiles.
The startup smoke check can seed from `CAPSULE_SMOKE_SEED_DATABASE` using
SQLite `VACUUM INTO`. Only the throwaway copy loses its settings. Smoke mode
uses the mock runtime and profile-owned task directory, and skips host settings
side effects; it must not connect copied sessions to live agents.

Main owns resource sampling every five seconds, sharing one in-flight async
process-table read. History is bounded to fifteen minutes and a point limit.
The renderer does not launch process-table commands while typing or rendering.


- Timeline of turns: user on the right, assistant markdown full-width, collapsed tool rows, a changed-files card scoped to each turn's saved result.
- Do not dump Artifacts or a second “run result” copy of the assistant reply.
- Composer: actual file attachments, `/` commands, `@` file mentions, `$`
  skills, prompt stash, permission profile, folder chip, Terminal.app.
- Mock runtime is first-class in explicit test mode (`autoConnect: false`), never a silent production fallback. Prompt tokens: `[approval]`, `[fail]`, `[verify]`, `[multi]`, `[long]`, `[buzz]`, `[tool]`.

### Project actions

Saved actions live in `projects.project_actions` JSON (schema v8): id, name,
command, and optional preview URL. `capsule:runProjectAction` starts the command
through `@capsule/terminal` in the conversation cwd, keeps bounded combined
output in memory, and exposes explicit list / stop IPC channels. Process groups
are terminated on Stop, project or conversation deletion, and app shutdown.
The IPC remains a closed set; there is no renderer-facing generic shell beyond
the existing project command runner.

The header and project screen share an asynchronous action editor. Saving
disables repeat submissions and keeps the entered values visible on failure;
only an acknowledged save closes it. Preview URLs accept HTTP(S) and bare
host/port addresses. Oversized commands and action lists are rejected by the
engine before persistence, rather than silently shortened or dropped.
Both action menus treat repository-declared actions as shared. Saving a local
action or a verification check stores only local additions and actual
overrides, so future changes to shared commands continue to take effect.

### Skill directory requests

Catalog Retry increments the fetch request, and a failed refresh preserves
the last catalog. Installed matches use IDs or source URLs, never names alone.
The catalog and detail controls both load a nonempty document before saving;
the engine also rejects empty instructions through every IPC entry point.
Undeclared skill versions use an empty database field and deserialize as
absent; the original non-null schema does not require a fabricated version.
Attachment waits for persistence, and late install replies cannot navigate a
different project, thread, or detail selection.

Each Files view owns a `SkillFiles` reader. Refresh invalidates old folder and
preview reads; file selection publishes only the newest response. Errors and
loading states are separate for the root, each directory, and the selected
preview. `SKILL.md` is preferred over the first alphabetical file. No global
skill files are modified. These library controls are shared by both runtime
routes and all harness presets. Existing remote write-channel checks remain
authoritative; a denied operation stays visible as a recoverable UI error.

The paired renderer waits for the socket's authenticated `ready` frame before
sending queued requests. Disconnects reject pending calls and discard their
queue; reconnection never retries writes without a caller. Socket identity
guards reject late callbacks from an older connection. Invalid JSON fails
pending calls with a readable connection error instead of stranding them.
Authenticated reconnects emit a connection notification to resnapshot the
workspace and selected thread. Outbound frames and socket backlog share an
8 MiB byte budget: oversized results fail by request ID, while oversized events
or backlog unsubscribe and close with 1013. Requests are never replayed as a
side effect of reconnecting, and read-only authorization is unchanged.

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
| Gateway | URL, connect / disconnect, token in Keychain, reading from another device |
| Projects | Create, delete, attach primary folder, choose or reset project icon |
| Source control | Branch prefix, force-with-lease, draft PRs, merge method, review delivery, watch-and-fix, auto-merge, commit / PR instructions |
| Skills | skills.sh token for the catalog |
| Shortcuts | Editable key bindings — see below |
| Diagnostics | Process monitor, subsystem versions, export |
| About | App icon squircle, version, copyright, copy version info |

Gateway also owns **Read from another device**: off, this Mac, or this
network. It shows the address, a Create link button that mints a single-use
pairing link, and the list of paired devices with a Revoke beside each. A
paired device is granted the `read` scope only — every channel is classified
in `packages/shared/src/ipc-scopes.ts`, an unclassified channel counts as a
write, and the socket checks the scope before the handler runs.
Revocation disconnects existing sockets and removes subscriptions immediately;
absolute session expiry closes them too. Every request, event and delayed reply
rechecks authorization. JSON primitives, malformed RPC shapes, oversized frames,
invalid pairing bodies and malformed URL encodings fail closed. UI tests use a
hidden, isolated renderer with network requests blocked, never the live profile.

Harnesses uses a two-pane catalog/detail layout. Installed and ready entries
sort first; selecting one reveals project dedication, Doctor output, start,
live sessions, and advanced session options. Project cwd and persistent/one-turn
mode stay in the compact context bar instead of repeating inside every agent
card. A live session's ACP-advertised model catalog renders as a selector; a
manual model-id field remains when no catalog is advertised. Missing or
signed-out CLIs cannot start until readiness becomes usable.

Harness status is cached by session id, not as a global chat notice. Both the
composer model picker and Harnesses option controls may refresh that cache;
neither renders the raw response in the conversation or changes the draft.
Raw status remains available in a bounded, collapsed **Session diagnostics**
disclosure in Harnesses, reset when the selected session changes. Stored full
ACP status reports are filtered from assistant history at render time without
deleting records; user-pasted reports and agent explanations are preserved.

---

## Skills Directory

- **Installed first**: the default tab separates Capsule-managed entries from
  read-only global skills discovered under `~/.agents/skills`,
  `~/.codex/skills`, the Claude config directory's `skills`, and
  `~/.config/opencode/skills`. Discovery recursively reads real `SKILL.md`
  documents, deduplicates symlinked installs by canonical path, and exposes a
  manual rescan. Global entries can be attached but not uninstalled by Capsule.
  Installed rows omit full paths and initially cap long groups at twelve;
  location remains available in the detail view. Guidance uses the shared
  Markdown renderer with frontmatter removed, while Source preserves the raw
  document. An explicit read-only Skills IPC lists and previews files under the
  selected skill root; canonical-path containment prevents traversal and
  symlink escapes. The Files tab presents that folder tree and renders Markdown
  previews in place.
- **Packed skills and packs**: pre-bundled skills across Web & React, Backend & Database, Testing & Quality, Agent Workflows, and Design & UI. Packs use flat compact rows; repeated CLI commands and included-skill controls live in the detail view.
- **Browse GitHub**: the directory reads a live catalog from the skill repositories on GitHub — names from the repository listing, descriptions from `SKILL.md` frontmatter. Results use compact rows capped to an initial page, and partial-source errors collapse behind a summary instead of taking over the view. No account is needed. The catalog is cached on disk because unauthenticated GitHub allows 60 requests an hour for the whole machine; a failed refetch serves the last good page with the reason attached rather than an empty list. Refresh forces a refetch. Links route into Capsule's embedded Browser.
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

- Monaco
- Capsule-owned ACP JSON-RPC server or bundled Claude Agent SDK
- GitHub OAuth (local `git` + `gh` only)
- Messaging-channel protocols (Gateway owns those)

When a limitation is lifted, delete it here and in ARCHITECTURE.md §9 in the same change.

Public onboarding starts at `docs/user/getting-started.md`. README and policy
pages distinguish actual routes, local verification, optional signing, browser
traffic and global skill discovery. Regenerate public policy pages after changes.

### Composer context and thread agents

Add context offers installed skills and project-file search. Its listbox uses
option IDs, active-descendant navigation and Escape dismissal. Explicit search
supports multiword queries. Skill selection is a single structured draft field,
scoped and persisted with draft/stash attachments, not duplicate `$name` prose.
File selection validates the exact path in the thread folder through the existing
attachment channel. Debounced search rejects stale responses; no new IPC is added.

Inspector **Agents** is distinct from **Side chat** (now the `chat` tab key).
Agents and the palette’s Show thread agents entry project the latest turn’s
events read-only. Only structured delegation inputs create task rows. Rows retain
spawn order and label missing usage, partial history, and last-reported states
after the parent ends. It is not a child-session orchestrator or workflow graph.
At most 100 delegation rows are shown from the bounded event window. Internal
subagents may be absent when a harness or route does not publish telemetry.
The inspector has an Agents-specific icon and context strip. Scoped loading and
error states distinguish missing telemetry from an empty report. Background
tool completion is **Launch completed · child status unknown**, not proof that
the child finished. Closed threads display their recorded runtime route rather
than the current harness default. Card borders and typography are explicitly
scoped so generic inspector heading rules cannot restyle the empty state.

### In-app updates

Both About surfaces and their clipboard summary read the running version from
main's update status (`app.getVersion()`), never a UI literal or the latest
release tag. A failed local read shows an unavailable state and disables copy.
The packaged desktop and root release versions must match before packaging;
internal workspace-package versions are not the desktop version.
About groups Copy and Check/Download/Restart buttons in one wrapping row, with
status and a secondary Release notes link beneath. Development installation
limits do not replace release-check errors in the status projection.

Sidebar, About and Settings share the same status/action hook. It subscribes
before the initial snapshot and ignores older responses. Main owns six-hour
checks (15-minute failure retry), canonical status and action reservations.
Compatible releases download automatically unless disabled in General settings;
restarts require an explicit confirmation. Native installation is admitted only
after turns, checks, Inspector commands, restores, IPC writes and PTYs finish
and pending checkpoint writes settle. A shared local/remote write reservation
blocks new work throughout native staging, while status and history stay
readable. Failed or timed-out staging releases admission without registering
a future quit callback. Stale preparation completions cannot install a retry.
Failures retain download/restart retry state and details rather than silently
redirecting to a release page. See [Update delivery](updating.md).

### Scoped state and bounded history

History loading/error state uses the same selection scope and request generation
as message pages. Empty welcome UI appears only after a successful read; retry
errors stay with the selected thread. Refreshes retain already visible messages.
Timeline following resets on thread selection and virtual rows are keyed by
thread so a previous scroll anchor cannot reposition a different conversation.
Message and code copying share an acknowledged, retryable clipboard control
with bounded feedback timers and stale completion guards.

Command and file discovery share `SearchDialog`: grouped, scroll-bounded rows,
combobox/listbox semantics, keyboard selection, focus containment/restoration,
and recoverable asynchronous actions. Queries are debounced and stale replies
are discarded. File results are scoped to project, active checkout and query;
the checkout is passed through the file-search bridge. Desktop-only commands
are labelled unavailable in paired viewers. Search errors do not masquerade as
empty results.

Saved turn diff base selection uses a single checkpoint-only SQL projection,
scoped to session and recorded cwd. Equal timestamps use insertion order.
Migration 18 indexes that lookup; it does not hydrate historical prompts/results.
Atomic editor replacement preserves existing regular-file permission bits,
including executable/private modes, unless the caller explicitly sets a mode.
The temporary file is exclusively created beside the target before rename.

Startup cancels interrupted `approval_required` runs alongside running, waiting
and queued runs, and cancels persisted pending approvals whose callbacks no
longer exist. Closed harness sessions cannot leave an orphan approval blocking
the next message or an update restart. Agent prose about errors is not a run
failure signal: lifecycle outcomes own completion and failure on both routes.
Machine-read local diffs force canonical prefixes and disable terminal colors,
including metadata-only, empty-file and binary previews.

Transcript retention is separate from event batching. The selected display
window retains at most 300 messages / 4 MiB of estimated UTF-16 text and metadata.
Message-page SQL selects a 65,536-character excerpt and an explicit truncation
flag without modifying stored text. Virtual turn rows use stable IDs, measured
heights, overscan, and focus/selection pinning. Prepending preserves the reading
anchor; viewport-only updates must not restore an earlier scroll position.
Once older-page navigation evicts newer rows, live replies stay in storage until
Return to latest. That action replaces the window only after a successful read.
Run receipts retain the visible time range plus 100 recent summaries (700 maximum).
Recent/live merge maps also have a 1,000-record ceiling. These are display bounds,
not deletion, provider token accounting, or an OS-wide memory guarantee.

Submission ownership captures draft revision before project/thread creation.
The revision covers prompt, attachments and skill. Promotion to a newly created
thread uses an in-memory handoff as well as best-effort storage. Failed submissions
use a recovery result that distinguishes durable Stash from temporary memory.
Steering admits one pending request per thread and clears only its submitted
revision; its independent draft store refuses new entries at 32 drafts / 2 MiB.

File drafts retain their exact project/root/path and base revision independently
of the preview component (32 dirty files / 16 MiB). Failed writes do not retry on
navigation. Explicit retry and overwrite remain separate actions. Recovery text
can be copied even if the original file is no longer readable. It is not durable
across renderer shutdown. Directory caches belong to one workspace identity and
refresh visible expansions on a five-second cadence; failure is not emptiness.
Diff reads capture a workspace/branch request generation before I/O.

PTY flow uses one sequenced frame in flight. The renderer sends readiness ACK 0,
then acknowledges each frame only from the terminal emulator's write callback.
Main pauses at 256 KiB, resumes at 64 KiB, and stops its owned shell at a 2 MiB
hard limit instead of dropping ANSI fragments. Exit waits for queued output to
drain. `terminalAcknowledge` is a write channel, denied to read-only viewers.
The dock retains 1,000 scrollback lines per pane, eight panes per folder and
16 folder docks; main permits at most 16 active/draining shell flows. Local
`chat.commit` and `terminal.render` timings share the existing bounded diagnostic
ring and contain no paths, commands or output.

Ownership renderer regressions exercise delayed first-thread creation, failed
storage and a 1,000-turn scroll/prepend fixture with fewer than 60 mounted rows.
Unit tests independently assert retained byte/count ceilings, receipt ownership,
draft conflict handling and PTY acknowledgement ordering.

Message pagination converts SQLite's numeric `contentTruncated` expression to a
boolean before IPC. The transcript uses an explicit conditional with a null
fallback, so an older main process sending numeric false cannot print a stray
zero. Actual message text, including a one-character `0`, is preserved.
Agent prose around direct tool/reasoning boundaries appears as separate message
rows in the same turn; a segment boundary is not run completion. Saved run
results retain blank-line separation between those messages. Where the agent
supplies ACP message IDs, changes in identity separate consecutive replies
without requiring a tool call; repeated IDs keep token chunks contiguous across
tool activity. Older agents keep the fallback boundaries. Reported model lists
accept flat or grouped options, retaining at most 32 choices per selector.

Workspace refresh reads one latest-run summary per visible thread. Selected
conversations and History use `listRunPage`: keyset pagination by creation time
and ID, 100 rows by default and at most 200. Result bodies are omitted and
`hasResult` preserves answer presence without retaining whole histories. The
new IPC channels are explicitly read-only for paired viewers. Full run details
remain available by ID; this is not a deletion or archive policy.

Harness status is keyed by thread, harness, live session key, effective cwd and
closed state. A response can publish only while that identity and request are
current. Repeated reads share a pending request; a forced refresh cannot be
overwritten by its predecessor. Project skill IDs include their canonical root.

Sidebar titles, empty messages, section labels, Show more and rename fields
share a title inset. DOM tests cover 220–352px widths and enlarged text.

Filesystem reads validate type and size on the descriptor actually read, with
nonblocking/no-follow opens, bounded allocation and a post-open identity check.
Path resolution checks canonical containment, including existing parents of
new files. Previews, configuration, icons, search and untracked-file statistics
reuse this reader. These checks reject static symlink escapes and detected
replacement races; they are not an OS sandbox against an adversary concurrently
renaming parent directories, and do not constrain a coding CLI's own file access.

### Public showcase

The marketing page embeds a lazy, same-origin `?showcase=1` iframe instead of
mounting the desktop shell into its own document. The sample subtree is inert;
the surrounding copy explicitly labels it read-only. Desktop shortcuts,
full-height layout and overlays stay in the preview document. A sample bridge
returns shaped read results and rejects unsupported operations. It does not
connect to a Gateway or agent. Mobile omits the preview below 900px.

`scripts/showcase-regressions.test.mjs` exercises the real public entry point
in an isolated Electron profile with external traffic blocked: desktop sample,
mobile overflow, unsupported writes and policy routes. It is a DOM check,
not a deployment or a live-harness verification.
