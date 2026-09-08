# Update delivery

The desktop main process owns `electron-updater`. It uses the GitHub provider
configured in `electron-builder.yml`; the library remains responsible for
download hashes and native signature verification. Capsule does not replace
that mechanism with a shell download or disable macOS security checks.

`Updater` distinguishes checking, offered, downloading, downloaded, installing
and unavailable states. A failed download retains its offer; a rejected restart
retains its downloaded file. Repeated checks and installs are coalesced or
refused while the action owns the state. `mergeUpdateStatus` is the canonical
projection for IPC replies and read-only status snapshots.

Packaged apps check on launch and every six hours, retrying failed checks after
15 minutes. This timer belongs to main and survives closing a macOS window.
`autoDownloadUpdates` defaults to true and can be disabled in General settings.
Automatic installation on quit is disabled. Restart admission rejects active
turns, verification, saved actions, Inspector commands, restores and PTYs, and
waits at most ten seconds for pending checkpoint writes. In-flight IPC writes
(including Git operations and harness creation) also block admission. The same
guard wraps local and remote handlers; unlisted channels default to writes.
Core separately blocks background execution while the restart reservation is
held. It does not stop work to make the update eligible.

On macOS the library's downloaded event means its local ZIP proxy is ready,
not that Squirrel has staged the replacement. `NativeUpdateStager` waits for
Electron's native downloaded event before calling the library's quit method.
New work stays blocked throughout that wait. Native failures and a two-minute
timeout abandon the attempt and release admission, without leaving a deferred
quit callback behind. A retry joins an outstanding native check or reuses the
staged update; it does not start a second download just because a waiter timed
out. Attempt identity prevents a stale preparation from installing or unlocking
a later retry. The library still owns the feed, hashes and signature checks.

The renderer's shared hook subscribes before reading current status, rejects
out-of-order reads and uses the same actions in Sidebar and both About surfaces.
No update control automatically navigates to a release page. The page remains
an explicitly labelled secondary link for release notes and manual recovery.
Status remains readable remotely; checking, downloading, installing and settings
changes still require write scope.

Release CI requires signing and notarization, uploads the DMG, ZIP, blockmaps
and `latest-mac.yml`, then publishes a draft release. The ZIP is required by the
macOS updater, even when the initial install used the DMG. Both the installed
app and its replacement must have compatible signatures. Unsigned development
builds are not evidence that native replacement works.

Release validation and local packaging require the root and desktop manifest
versions to match. Electron's `app.getVersion()` supplies the running version
to update status, About and diagnostics; workspace-library versions do not.
The built-app smoke check verifies that runtime version against the manifests.
Renderer regressions exercise both About entry points and clipboard output with
a different available release and an offline update check.

Unit and renderer regressions cover state transitions, failed download/restart
recovery, duplicate actions, initial snapshot races and the About entry point.
Deferred native-event regressions exercise the installed macOS updater's quit
implementation with an inert native emitter; no app or real installer is run.
A production delivery gate remains a signed old-version → new-version test in
an isolated profile, including restart and version verification. Do not test
installation against a developer's open Capsule profile or publish a release
just to exercise the updater.
