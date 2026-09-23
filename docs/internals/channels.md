# Shared-channel adapter

The optional relay workspace deliberately extends the previous Gateway-only
channel contract through a thin installed-CLI adapter, not another messaging
protocol implementation. Existing `createBuzzAdapter` Gateway filtering remains
unchanged. `SharedRelayClient` in `@capsule/buzz` supplies the new desktop view.

Main owns the client. Named IPC methods validate origins, IDs, message sizes,
roles and acknowledgments. The renderer imports shared types only. Both local
runtime routes can coexist with this view; no ACP/provider messages are injected
into either route. An incoming message is display data, never a command.

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
The upstream profile `picture` is the only avatar source; missing/failed images
use initials for people and agents. Visible avatars request bytes by public key
over desktop-only IPC, from the main-owned set of known member profiles. No
generic URL fetch is exposed. Raster PNG/JPEG/WebP/GIF is signature-checked,
limited to 256 KiB, six concurrent requests, four seconds per request and two
redirects. Profile metadata and the session-local cache are bounded. Downloads
carry no credentials/cookies/referrer. Non-relay hosts must use public HTTPS;
all DNS addresses are checked and passed directly to the socket lookup to
prevent rebinding. The explicitly connected relay origin may serve its own
private-network images. Every redirect is revalidated. The renderer receives
data URLs, so its image CSP stays closed to remote origins. Disconnect cancels
downloads and drops profile/cache data. No photos are written to disk.

Unsent text and explicit public-key mention ranges are memory-only, keyed by room and
root message while the view is mounted. An acknowledged post clears its draft;
a rejected post preserves it. The renderer does not auto-retry ambiguous writes.
Edits inside a selected mention invalidate its recipient; surrounding edits shift
the range. Typed autocomplete respects IME, selection, Escape and arrow keys.
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
