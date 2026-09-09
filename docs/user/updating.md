# Updating Capsule

Settings → About and **About Capsule** in the app menu show the version of the
running app, not the newest release available online. **Copy version info** uses
that same version. A downloaded update does not change it until the new app has
started. If you still see an older version after installing, quit the old copy
and open Capsule from Applications; check that you are not launching a copy from
a mounted disk image. Version information remains available when release checks
are offline. If the local status cannot be read, About says it is unavailable
instead of displaying a placeholder version.

Capsule checks for compatible updates when it starts and periodically while it
runs. By default, it downloads them in the background. Turn off **Download
updates automatically** in Settings → General if you prefer to download on
demand.

The sidebar and Settings → About show the same download progress and
**Restart & install** action. Save open files first. Capsule refuses the restart
while turns, checks, commands, saved actions, Git operations or terminal sessions
are active; finish or stop them, then try again. After you confirm the restart,
new work and file saves pause while the system prepares the replacement.
Status and conversation history remain readable. Background downloads alone
never trigger a restart or install on quit.

A failed download offers **Retry download**, keeping the update in the app.
A failed or blocked restart keeps the downloaded update ready to try again.
If preparation fails or times out, you can resume work. A late completion from
that attempt cannot unexpectedly close the app; installing requires another
explicit restart attempt. Once the native installer has staged an update after
your restart request, it may apply it the next time the app starts.
Reopening a window restores the current update state.

Development builds and incompatible signatures cannot update in place.
The **Release notes** link in About opens the release page, where a manual
download remains available for recovery. Checking for an update does not open
that page automatically. A failed check keeps its error visible even in a
development build. Do not disable system security checks to work around an
unexplained signature warning.

## Update states

| What you see | What it means |
|---|---|
| Checking for updates | A check is still in progress. |
| You’re up to date | The compatible feed reports no newer update. |
| Download update | A compatible version can be downloaded inside Capsule. |
| Downloading update | The download is in progress; the percentage is shown. |
| Restart & install | The downloaded update is ready; restarting requires confirmation. |
| Retry download or retry restart | The previous attempt failed; its explanation remains visible. |
| Retry update check | The check failed; retry without leaving the app. |
