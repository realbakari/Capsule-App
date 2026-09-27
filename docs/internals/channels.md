# Shared-channel adapter

The optional relay workspace deliberately extends the previous Gateway-only
channel contract through a thin installed-CLI adapter, not another messaging
protocol implementation. Existing `createBuzzAdapter` Gateway filtering remains
unchanged. `SharedRelayClient` in `@capsule/buzz` supplies the new desktop view.

Main owns the client. Named IPC methods validate origins, IDs, message sizes,
roles and acknowledgments. The renderer imports shared types only. Both local
runtime routes can coexist with this view. Incoming messages are display data
unless the authenticated user explicitly enables the local route below.

## Persistent channel routes

`ChannelRoutes` bridges the installed relay CLI to the existing session/run
pipeline. It does not implement an agent loop, ACP server or channel protocol.
`configureChannelRoute` records origin, authenticated public identity, channel,
project and harness in the local settings repository. `channelRouteStatus`
exposes run links, runtime errors, approval waits and delivery state. Both IPC
methods are denied to paired viewers, including the read.

The five-second, non-overlapping main-process poll admits only new messages
authored by the authenticated identity and starting with `@capsule`. Enabling
records a baseline; existing messages and other members' messages never run.
Polling continues while the app is open after Channels restores credentials.
Each relay root maps to a saved project conversation; its continuation uses
that session's established direct or Gateway route. New conversations use
Supervised permissions and the local project folder, without setup actions.

Admissions are persisted before launch, serialize per channel, and retain a
timestamp watermark and deduplication ledger. Restart does not replay queued or
interrupted work. A completed result is published to the original root as the
connected identity with a Capsule/harness label and no agent notification tags.
Delivery is persisted as pending before sending; missing acknowledgments and
restarts during sending become uncertain, never automatic retries. Empty or
oversize results stay local with a visible explanation. Errors pause admission;
approval waits remain inspectable in the conversation. Pause suppresses new
work and replies, not an already running agent. Stop run remains explicit.

Bounds: 16 saved routes, 200 local turns per route, ten pending turns, recent
100 relay messages. A full history window beyond the saved watermark pauses
rather than claiming everything was consumed. Re-enabling skips the current
window and preserves prior thread sessions for the same project/harness.
Future-dated events cannot advance the watermark. Identity changes fence all
in-flight work; stored routes never transfer to another relay identity.

## Explicit harness delegation

`ChannelHarness` in Core admits **Run with Capsule** on a selected message. Main
re-fetches the joined channel and bounded message window, validates the source
ID, then creates a Supervised, local-folder conversation through `createSession`
and `sendMessage`. There is no second agent loop or relay agent provisioning.
Every harness uses its existing route and capability checks. Gateway prompt
limitations and direct approval handling remain unchanged. Project worktree
setup actions are not triggered by this entry point.

Concurrent admission for the same message shares one promise. At most 100
connection-scoped jobs are retained; terminal jobs can be evicted, but their
normal sessions and runs remain persisted. Jobs bind to the relay connection
generation, so reconnecting even to the same URL cannot reuse publication rights.
Opening or polling never starts execution. A disconnect during an admitted run
does not cancel that local conversation, but blocks later relay publication.

Completed results require explicit reviewed sharing. Main fixes the destination
to the original channel/thread and sends no mention recipients. Publication is
labelled with the harness and uses the connected human identity. Pending sends
cannot be duplicated; uncertain sends cannot be retried automatically. The
renderer cannot supply a different source prompt or destination to these APIs.
`runChannelHarness`, `listChannelHarnessJobs` and `shareChannelHarnessReply` are
all write-scoped and denied to paired viewers, including job/result reads.
Selected source text and results enter the normal local conversation database;
unselected channel history remains a memory-only recent window.

## Process and identity boundary

- The installed `buzz`/`buzz.exe` receives fixed operation arguments, explicit
  `--relay` and JSON format, with no shell. The environment is allowlisted;
  only the supplied `BUZZ_PRIVATE_KEY` identity is carried.
- Keys never appear in argv, status, settings or logs. Message text uses stdin.
  Native errors are sanitized rather than echoing stdout/stderr or credentials.
- Remember is explicit in the connection form or connection menu. Core stores
  the URL/key pair atomically in `secrets/shared-relay.json`, encrypted with
  platform safeStorage and mode 0600. There is no plaintext fallback; Linux's
  `basic_text` backend does not qualify. Restore runs once on opening Channels,
  never during engine startup. Disconnect preserves the encrypted record;
  Forget deletes it. Restore errors preserve it and permit explicit retry.
  Status only carries the URL and capability/state flags, never the saved key.
- Commands have a 20-second execution timeout and 2 MiB output bound; at most four run
  concurrently, with a bounded 64-entry FIFO queue. Ordinary overlapping reads
  wait for a slot; identical in-flight reads share a promise. Writes are never
  coalesced or retried. Disconnect cancels queued work and aborts owned calls. Stale connection responses are
  rejected even if a child finished just as cancellation occurred.
- A successful process exit is not an accepted write. Each mutation requires
  `accepted: true`; posting/creation also require valid event/channel IDs.
- The relay remains responsible for authorization and signed-event verification.
  Capsule additionally rejects cross-channel responses and malformed payloads.
- All relay IPC channels are write-classified, even status and message reads,
  so paired devices cannot borrow the desktop identity or inspect private rooms.

## Rendering and limits

The view polls every five seconds without overlapping its own polling loop;
hidden views pause polling and unmount cancels timers. Histories are bounded
recent windows, not a durable local mirror. Markdown uses the existing safe
renderer; files and images from remote text do not acquire local file access.
The upstream profile `picture`, `image`, or `avatar_url` is the only avatar
source, including when `users get` still returns a raw kind 0 event. Missing or
unsupported images fall back to initials. The fixed inline emoji SVG format is
decoded in main into an allowlisted emoji string and six-digit hex color; SVG
markup is never rendered or passed as image bytes. The shared member descriptor
carries that inert representation to every avatar surface. Raster cache updates
notify all mounted avatars, and visible failed requests retry after the cache TTL.
Author, mention and member triggers open an accessible native profile dialog
with the public key and explicit external-host explanation for agents. It never
infers a host model, presence or execution state.
Failed images use initials for people and agents. Visible avatars request bytes
by public key over desktop-only IPC, from the main-owned set of known member
profiles. Relay `/media/` blobs are loaded with `buzz media get`, which signs
the request. One picture is fetched once per connection and reused everywhere
it appears; two downloads run at a time so they do not stampede the transcript.
Other hosts stay anonymous public HTTPS. No generic URL fetch is
exposed. Raster PNG/JPEG/WebP/GIF is signature-checked,
limited to 256 KiB, six concurrent requests, four seconds per request and two
redirects. Profile metadata and the session-local cache are bounded. Downloads
carry no credentials/cookies/referrer. Non-relay hosts must use public HTTPS;
all DNS addresses are checked and passed directly to the socket lookup to
prevent rebinding. The explicitly connected relay origin may serve its own
private-network images. Every redirect is revalidated. The renderer receives
data URLs, so its image CSP stays closed to remote origins. Disconnect cancels
downloads and drops profile/cache data. No photos are written to disk.

Unsent text and explicit public-key mention ranges are memory-only, keyed by room and
root message while the view is mounted. A view-owned observable draft store
also owns pending admission and errors, so navigating away and back cannot
admit duplicate posts. An acknowledged post clears only its submitted revision;
a rejected post preserves it. The renderer does not auto-retry ambiguous writes.
Edits inside a selected mention invalidate its recipient; surrounding edits shift
the range. Both typed and toolbar autocomplete respect IME, selection, Escape
and arrow keys; Enter selects rather than implicitly submitting a form.
Colliding names carry shortened identity hints. The channel and thread composer toolbar inserts Markdown
using selection-aware edits and retains untouched signed mention ranges. Emoji
insertion is local text editing, not a relay command. History acknowledges catch-up
only when the latest message changes or the user chooses Latest, not on every
callback rerender or identical poll.
Only unambiguous names from signed message p-tags receive prose decorations;
Markdown code and link labels stay literal. Reply-marked references route replies
back to their root, even outside the recent window. Root-only references remain
top-level citations. Thread summaries use only the loaded bounded windows.

Reactions are fetched on explicit interaction, preventing a process fan-out per
message. Counts deduplicate returned identities; the CLI resolves the connected
public identity for own-reaction state when possible. Removal is always delegated
to the CLI's own-author check. Channel settings use exact-name metadata search plus
exact ID matching, with absent metadata shown as unknown. Editing, archive,
unarchive and deletion use named CLI operations and accepted acknowledgments.
Destructive confirmations live in the renderer; relay authorization remains final.
No owner or presence state is inferred from profile metadata.

Protocol fixtures cover validation, acceptance, cancellation, memberships and
normalization. Isolated Electron tests cover failed/successful sends, mention
identity, drafts, threads, keyboard composition, focus, scroll anchoring and
paired-viewer denial. These tests do not substitute for a live relay/agent-host
acceptance test or native Windows verification with the installed CLI.
