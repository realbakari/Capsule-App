# Mobile app (`apps/ios`)

A native SwiftUI app for iPhone and iPad that pairs with a running Capsule
desktop. It reads threads as they stream and, with a phone pairing, sends
messages, stops runs and answers approvals. No agent runs on the phone; the
desktop owns execution exactly as it does for the browser workspace.

## Protocol

The app speaks the protocol in `packages/remote` that the browser workspace
uses. It adds nothing to the channel allowlist:

- `POST /pair {token, label}` trades a single-use pairing token for a session
  token (`{token, scopes, expiresAt}`, twelve hours).
- `wss://…/rpc` (or `ws://` for a browser link): the first frame is `{token}`.
  The desktop answers `{type:"ready", scopes}`. Calls are
  `{id, channel, args}`, answered by `{type:"result", id, result | error}`.
  Events are `{type:"event", event, payload}`.
- The reads the app uses are listed below.
  - Threads: `listProjects`, `listSessions`, `listLatestRuns`,
    `listApprovals`, `listMessagePage`, `listRuns` and `listRunEventPage`.
  - Changes: `turnDiff` is called first with `summaryOnly` for the file list,
    then with `relative` for one file's patch, so a big turn never sends a
    whole patch.
  - Project view: `gitStatus`, `gitDiff`, `listFiles`, `previewFile` and
    `listPullRequests`.
  - New-thread picker: `listAgents`.
  - Every call times out after 30 s (45 s for patches), so a slow computer
    shows an error with a retry instead of a spinner. The writes are `sendMessage`, `stopRun`, `resolveApproval` and
  `createSession`, which are the control set in
  `packages/shared/src/ipc-scopes.ts`.
- Close code 4401 ends the pairing. The app stops retrying and asks the user
  to pair again.

## Phone listener (pinned TLS)

Plain HTTP on a local network is read-only by design, so a phone could not
send or approve without an HTTPS proxy. The desktop therefore runs a second
listener for phones whenever browser access is on and no public HTTPS URL is
configured. It is described below.

- **Identity.** An ECDSA P-256 self-signed certificate made with `node:crypto`
  (`packages/remote/src/tls.ts`, a short DER encoder, no dependency). It is
  stored as `remote/remote-tls-{key,cert}.pem` in the profile (key `0600`), and
  replaced only if it fails to parse or nears expiry. Replacing it ends phone
  pairings.
- **Pairing code.**
  `capsule://pair?host=…&port=…&fp=<sha256 of cert DER>&token=…&name=…`,
  shown as a QR code under Settings → Gateway → Browser access → Phone. The
  `--remote` launch flag also prints one.
- **Trust.** The app accepts exactly the certificate whose SHA-256 matches
  `fp` (`PinnedTrust.swift`). The system CA list is not consulted. A mismatch
  cancels the handshake before the token is sent.
- **Separation.**
  - Grants and sessions carry a `transport` (`browser` | `phone`). Each
    listener redeems only its own grants and accepts only its own sessions, so
    a control token minted for TLS is never accepted over plain HTTP, and a
    browser link is never accepted on the phone listener.
  - The phone listener rejects any request with an `Origin` header, which
    keeps every web page off it, and it serves no static files.
- **Ready frame.** The `ready` frame also carries `protocol` (currently 1)
  and the desktop's `version`. The app shows the version in Settings and
  asks for an update when `protocol` is below the app's.
- **Lifetime.** A phone session lasts 30 days and renews on every `ready`.
  The `ready` frame carries `expiresAt`, and the app saves it. Browser
  sessions keep their 12 hours.
- **Stable address.** The phone port is remembered in `remote/remote-phone-port`
  and reused on the next start. If that port is taken, a new one is chosen.
- **Rediscovery.** With reach set to This network, the desktop advertises
  `_capsule._tcp` through `/usr/bin/dns-sd -R` (macOS only, no dependency).
  The child process is stopped with the listener. The TXT record is
  `fp=<first 16 hex of the fingerprint>` and `v=1`.
  - When an address stops answering, the app browses for up to 5 s, at most
    once every 30 s (`Connection/Discovery.swift`). It resolves the matching
    service to an IPv4 address and port, saves it, and reconnects.
  - An advert is only a hint: the pinned certificate still has to match
    before the token is sent.
  - Users can also set an address by hand (Settings → Edit address).
  - Pairings are deduplicated by fingerprint, so pairing a computer again at
    a new address replaces the old pairing rather than adding one.
- **Scope.** Phone codes grant `read` + `control`. Control is the same paired
  conversation control a browser gets: new threads are Supervised and use the
  project folder, approvals are once-only or deny, and there are no
  attachments, terminals or settings.
- **Ports.** `CAPSULE_REMOTE_PHONE_PORT` pins the phone port; otherwise it is
  ephemeral, like the browser port. A pinned port keeps paired phones
  reachable after a restart.
- **Restarts.** Phone sessions survive a desktop restart. Their token hashes
  and metadata, never a usable token, are kept in
  `remote/remote-phone-sessions.json` (`0600`). Revoke rewrites the file, and
  turning Browser access **Off** clears it. Browser sessions stay in memory
  only.

Behind `CAPSULE_REMOTE_PUBLIC_URL` (an HTTPS proxy) the phone listener is not
started. A phone can pair with that proxy's browser link and gets the scope
the link was made with.

## Control arguments

`apps/desktop/src/main/remote-control.ts` rebuilds the arguments of every
control channel; a control channel without rules there is refused.
- **Follow-ups.** `updateFollowUps` accepts `add` with text only (no
  attachments, which are local paths), plus `remove`, `move` and
  `cancel-resume`. `schedule` is refused because it replays a stopped turn's
  files.
- **Thread actions.** `renameSession` (title 1–200 characters),
  `archiveSession`, `restoreSession` and `pinSession` (boolean only) are
  control channels. `deleteSession` is not.
- **Uploads.** `uploadAttachment(sessionId, name, mimeType, base64)` is phone
  transport only.
  - Accepted types are `image/jpeg`, `image/png`, `text/plain`,
    `text/markdown` and `application/json`.
  - Uploads are capped at 3 MB decoded. The base64 length is checked before
    anything is decoded.
  - The name is sanitized and capped at 120 characters.
  - The main process checks the bytes against the declared type (JPEG and
    PNG magic bytes, and no NUL bytes in text). It writes the file to
    `attachments/remote/<session>/` with mode `0600` and records it in
    `RemoteUploads`.
  - `sendMessage` and follow-up `add` accept `attachments` only as paths
    recorded for that same session. The attachment is rebuilt from the
    record, never from the phone's fields.
  - The phone listener's `maxPayload` is 4 MB. The browser listener's stays
    at 64 KB.
- **Approvals.** `resolveApproval` accepts `approved_once` and `denied` from
  any paired device. It also accepts `approved_session` from a phone
  (pinned TLS) transport, so the server passes the caller's transport into
  `invoke`.

## Notifications while the app is closed (designed, not built)

iOS only delivers notifications to a closed app through APNs, and APNs needs
a server holding the app's push key, which the desktop must not hold. The
design keeps that server content-blind:

1. **Registration.** The app registers for remote notifications and sends its
   device token to the desktop over the pinned channel, through a new
   control channel `registerPushToken`.
2. **Sealing key.** At registration the phone also generates a 256-bit key
   and gives it to the desktop over the same channel.
3. **Sending.** When a run settles or an approval appears, the desktop posts
   `{deviceToken, ciphertext}` to the relay.
   - The ciphertext holds the kind, thread id and title, sealed with that
     key: ChaChaPoly via `node:crypto` on the desktop, CryptoKit on the
     phone.
   - The relay only forwards to APNs, with `mutable-content: 1`.
4. **Receiving.** A Notification Service Extension decrypts the payload and
   sets the title and body. If decryption fails, it shows a generic "Capsule
   needs you" notification.
5. **Opt-in.** It is opt-in in Settings, and the privacy copy changes to "an
   encrypted, content-free wake-up passes through Capsule's push service".
6. **Approval actions** work unchanged: the app connects, decides once, and
   never resends.

Until the relay exists, notifications come from the live connection, a 25 s
background grace period, and `BGAppRefreshTask`. The welcome screen says
"while Capsule is open" so it doesn't over-promise.

## Sample workspace

`Store/SampleData.swift` holds fixtures for one project with three threads:
- a finished turn with steps and a two-file diff
- a pending approval
- a research answer with a table

`Workspace.startSample()` loads them with no connection. While it's on,
every network entry point returns local data instead:
- **Sending** appends the user message and a fixed reply.
- **Approving** settles the sample run.
- **Thread actions** edit the fixtures.
- **Search** scans the fixtures.

Nothing leaves the device. It exists for App Review (guideline 2.1) and for
trying the app before installing the desktop. The App Review notes in
[mobile-release.md](mobile-release.md) point reviewers at it.

## App structure

| Folder | What lives there |
| --- | --- |
| `Connection/` | Pairing-link parsing, pairing exchange, Keychain, pinned trust, and the socket actor. |
| `Store/` | `Workspace` (the only owner of the connection), `ThreadModel` per open thread, the offline snapshot, and notifications. |
| `Model/` | Wire types (lenient decoding) and the unified-diff parser. |
| `Views/` | SwiftUI screens. |
| `Shared/` | Compiled into both the app and `CapsuleWidgets`: the Live Activity attributes, the widget snapshot, and the Allow once / Deny intents. |
| `../CapsuleWidgets/` | Widget extension (`dev.capsule.mobile.widgets`): the Live Activity views and the status widget. |

Rules the code keeps:

- **Never replay a write.** A call in flight when the socket drops fails with
  "check before trying again". The composer keeps its text, approval cards
  re-enable, and a notification action that can't confirm posts "Couldn't
  confirm your answer" instead of retrying.
- **Queue, don't block.** While a turn runs, the composer queues through
  `updateFollowUps`. The desktop sends queued prompts when the thread frees
  up, even with no phone connected. The queue arrives with the thread load
  (`getFollowUps`) and through `follow-ups-updated` state events.
- **Refetch on ready.** Every `ready` triggers a full read of the list data and
  any open threads. Events are applied on top; nothing is stitched together
  from missed events.
- **Backoff.** Retries start at 1.5 s and double to 30 s, with ±20% jitter.
  A network path change or returning to the foreground retries immediately.
  An unanswered ping after 25 s idle drops the socket.
- **Offline copy.** Projects, threads, latest runs, pending approvals and the
  last 60 messages of the 30 most recent threads are kept per host in
  Application Support. The copy uses file protection, is excluded from
  backup, and is shown with a "saved N ago" banner while disconnected.
- **Secrets.** Session tokens are kept in the Keychain
  (`AfterFirstUnlockThisDeviceOnly`), never in defaults or the snapshot.
- **Notifications.** Notifications are local only: an approval request, and a
  live run reaching a final status. They are posted while connected, during a
  25 s background grace period, and from `BGAppRefreshTask` checks. They show
  the thread title, never message content. Remote push would need a relay
  service and is not implemented.

## Live Activity and widget

Supervision without opening the app, built on what the socket already
carries. No server is involved.

- **Starting.** `Workspace.supervise(_:)` runs after every applied event.
  A live run starts or updates the thread's activity; a settled run ends it
  with its final state and `dismissalPolicy .after(+15 min)`. ActivityKit
  only allows `Activity.request` from the foreground, so a run that starts
  while the app is suspended gets no activity. Push-started activities need
  the relay described above.
- **Step text.** Each running `tool` event's `ToolStep.sentence` ("Running
  npm test") is kept per thread in `liveSteps`, so the activity follows turns
  whose thread isn't open.
- **Budget.** `LiveActivities` sends phase changes (an approval arriving)
  at once and coalesces step changes to one update per 2 s.
- **Activities aren't Sendable.** The controller stores activity ids and
  looks each activity up again inside a detached task to update or end it.
- **Leftovers.** At launch, `installApprovalHandling()` ends any activity
  whose thread no longer has a live run in the offline copy, and adopts the
  rest.
- **Allow once / Deny.** `AllowOnceIntent` and `DenyIntent` are
  `LiveActivityIntent`s with `authenticationPolicy = .requiresAuthentication`.
  The system runs `perform()` in the app's process (verified in the
  simulator's AppIntents log), where `ApprovalHandling.answer` routes to
  `resolveFromNotification`, the same never-retry path as notification
  actions. `perform()` can be re-run, so `LiveActivities.claim` lets each
  approval id through once.
- **Widget data.** After each offline-copy save, `publishWidget()` writes a
  `WidgetSnapshot` (counts and up to four threads) to the App Group
  `group.dev.capsule.mobile.shared` and reloads the `CapsuleStatus` timeline. It
  skips unchanged snapshots and reloads at most every 30 s, except when the
  "needs you" count changes. Both privacy manifests declare App Group
  defaults (`1C8F.1`).
- **Opening.** Both surfaces open threads through `capsule://thread?id=`,
  the same route as thread links and quick actions.
- **Checking.** In a Debug build, `-CapsuleSample YES -CapsuleActivity YES`
  starts the sample approval's activity.

## Design

- **Palette.** A warm paper canvas (`Screen`) in light mode and warm
  near-black in dark mode.
- **Graphite.** Graphite is the primary action colour in both appearances.
  The launch and welcome screens sit on the icon's graphite tile.
- **Messages.** The user's messages use a soft tonal bubble. Agent prose is
  set in New York (`.fontDesign(.serif)`) at body size with generous leading.
  Code, tables, tool steps and all chrome stay in SF.
- **Thread list.** The list is flat, in sections by status (Needs you,
  Working, Pinned, Recent). Each row has two lines: the project, with its own
  icon and the agent, then the title.
- **Navigation.** iPhone uses a `NavigationStack` path; iPad uses a split
  view. Search and compose sit in the bottom toolbar.
- **Deployment target.** iOS 26, for Liquid Glass, toolbar spacers and the
  bottom search item.
- **iOS 27.** SDK 27 APIs are gated with `#available`; today that is
  `toolbarMinimizationBehavior` on the list's bottom bar.

## More features

- **Dictation** (`Store/Dictation.swift`). `SpeechAnalyzer` with a
  `SpeechTranscriber` (volatile results), fed from an `AVAudioEngine` tap
  through an `AVAudioConverter` into `bestAvailableAudioFormat`. On-device
  only; assets install on first use. The transcript lands in the draft and is
  never sent automatically.
- **Agent commands.** `harnessStatus` (a read channel) returns
  `parsed.availableCommands`; the composer lists them under `/` beside
  skills. The answer is cached per thread for five minutes, because asking
  reaches the agent. Sending is an ordinary `sendMessage` of `/name args`.
  Both routes: direct mode reports commands from ACP
  `available_commands_update`; a Gateway thread shows whatever its status
  reports, often nothing.
- **Other computers** (`Store/HostWatcher.swift`). Up to three paired
  computers besides the active one keep their own `Connection` and load only
  threads, latest runs and pending approvals. They notify (the notification's
  `hostID` names the computer), answer approvals directly, and stop with the
  active connection when the app goes to the background. Opening one of their
  threads activates that computer. No protocol change.
- **Inspector.** At regular width, changes and the project open with
  `.inspector`, and `SidebarRoom` hides the split view's sidebar while one is
  open. On compact width they stay sheets: an inspector attached there, even
  hidden, takes over the root `NavigationStack`.
- **Windows.** `WindowGroup("Thread", id: "thread", for: String.self)`;
  visible threads are a set, one entry per window, so notification
  suppression is right with two windows.
- **Share extension** (`CapsuleShare`, `dev.capsule.mobile.share`). Writes
  `SharedItem` JSON and reduced JPEGs to `Inbox/<id>/` in the App Group. An
  extension can't open its app without private API, so the app checks the
  inbox when it becomes active and presents `NewThreadView` prefilled. Items
  expire after a week; starting or cancelling removes them.
- **Ask about lines.** `PatchLines` takes an `ask` closure; tapped lines form
  a range and `PatchLines.quote` writes `path` lines N–M plus a diff block
  into `pendingInsert`.
- **Pull request detail.** `getPullRequest` (read) decoded leniently into
  `PullRequestDetail`; files open the patch from its `diff`.
- **Syntax colour** (`Model/SyntaxHighlighter.swift`). A single-pass
  scanner for comments, strings, numbers and keywords in about fifteen
  languages; unknown languages stay plain. Results are cached by text.
- **Localization.** String Catalogs for the app, widget and share targets
  plus `InfoPlist.xcstrings`; `SWIFT_EMIT_LOC_STRINGS` is on. After adding
  strings, build and run `xcstringstool sync` with the targets'
  `.stringsdata`, as the catalogs aren't synced by command-line builds.
- **Theme.** `display.theme` (system, light, dark) through
  `preferredColorScheme`, and `display.typeface` (serif, system, rounded),
  named as on the desktop's Appearance settings.
- **Backdrop** (`Model/Backdrop.swift`, `Views/BackdropView.swift`). After
  each refresh the phone reads `configGetEffective` (a read channel) and
  decodes only `themes.backdrop.{light,dark}`; `imageUrl` is desktop-only
  and ignored. The five scenes (grain, mesh, night, dots, paper) are drawn
  natively behind the transcript and composer, mirroring `backdrop.css`, at
  no more than each scene's ink from `SCENE_INK`. `Backdrop.scrim` ports
  `backdropScrim`: a veil of the page colour, never below `dim`, enough for
  4.5:1 over the scene's worst colour. Opacity and blur apply; `fit` is for
  images. The last copy is kept per computer for offline use. Settings →
  Display → **Backdrop from your computer** turns it off. Older computers
  without the channel draw nothing. Debug: `-CapsuleBackdrop <scene>`.

- **While you were away** (`Store/Workspace+Brief.swift`). `awaySince` is
  set when the app goes to the background; `brief()` lists latest runs that
  settled after it, plus runs waiting on an approval, each with
  `Brief.headline` of the agent's last reply (first prose sentence, openers
  like "Done." skipped). Built from data the list already has; no new call.
- **Harness marks** (`Views/HarnessMark.swift`). The desktop's marks: the
  SVG imagesets in `Assets.xcassets/Harness` are generated from
  `apps/desktop/src/renderer/src/lib/provider-marks.ts` (MIT-licensed
  LobeHub icons). A variant id wears its product's mark (`claude-code` →
  Claude). Brand colour only where it reads (relative luminance ≥ 0.12),
  otherwise the text colour; agents without a mark get the same two-letter
  monogram as the desktop. When the desktop adds a mark, run
  `node apps/ios/scripts/generate-harness-marks.cjs` from the repository root
  and add its entry to `Harness.marks`. The script spells out SVG arc flags
  (`01` → `0 1`): iOS's SVG renderer misreads the compact form browsers
  accept, which bent the Codex and Gemini marks out of shape.
- **Composer.** The thread's agent mark and name sit at the right of the
  composer's controls row, and the placeholder reads "Reply to <agent>".
- **Deny and reply.** Denies, then focuses the composer through an empty
  `pendingInsert`; the agent hears why from the next message.

## Performance

- **Transcript.** The transcript is lazy and Markdown parses are cached
  (`MarkdownBlock.cachedParse`, an `NSCache` keyed by text).
- **Observation.** `ThreadModel`, each run's `RunLog` and each streaming
  `LiveReply` are separate observable objects, so a streaming token redraws
  one bubble, not the thread.

## Building

`apps/ios/project.yml` is the source of truth; run `xcodegen generate` in
`apps/ios` after adding files. Two targets ship: `Capsule` and the embedded
`CapsuleWidgets` extension. Both carry the App Group entitlement. The generated project is committed. Tests use
Swift Testing (`CapsuleTests`). Releasing is in
[mobile-release.md](./mobile-release.md).
