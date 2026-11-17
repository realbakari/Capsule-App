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

## The update button

The round button at the right end of the sidebar's bottom row is the update
control. Its icon shows where an update stands, and its tooltip names the
version and what pressing it does:

- A circular arrow checks for updates. It spins while a check runs. When you
  press it and nothing newer exists, a notice says you are up to date.
- A download arrow with a dot means a version is ready to download. Press it to
  download inside Capsule.
- A ring fills around the arrow while the update downloads.
- A circular arrow with a check mark means the update is downloaded. When a
  download finishes, a notice says so and links to the release notes at
  cpcl.dev/updates.

Press the button once the update is downloaded to restart and install. Capsule
asks first, naming the version. Save open files first. Capsule refuses the
restart while turns, checks, commands, saved actions, Git operations or terminal
sessions are active; finish or stop them, then try again. After you confirm the
restart, new work and file saves pause while the system prepares the
replacement. Status and conversation history remain readable. Background
downloads alone never trigger a restart or install on quit.

Settings → About shows the same progress and the same **Restart & install**
action. The command palette's update row does what the sidebar button would do
next: **Check for updates**, **Download update** or **Restart & install**, and
reports the result the same way. **About Capsule** in the palette shows the
version you are running.

A failed download or restart keeps the update in the app; the tooltip says
what to retry, and pressing the button tries again.

If Capsule restarts to install an update but comes back on the old version, it
tells you once: a notice says the update didn't install and offers **Retry**,
and the update button says the same until you try again. Retrying checks for
the update, downloads it again, and then offers the usual restart. A check, download or
restart you started that fails shows a notice with the reason. A check
Capsule ran on its own in the background stays quiet when it fails and tries
again later.
If preparation fails or times out, you can resume work. A late completion from
that attempt cannot unexpectedly close the app; installing requires another
explicit restart attempt. Once the native installer has staged an update after
your restart request, it may apply it the next time the app starts.
Reopening a window restores the current update state.

The update button is only on the computer running Capsule. A paired device
reading your workspace does not show it, because updating replaces the app on
that computer.

Development builds and incompatible signatures cannot update in place. In a
development build the update button is dimmed and its tooltip says why.
The **Release notes** link in About, and the one on the "downloaded" notice,
open the release page for the version on offer, where a manual download
remains available for recovery. Checking for an update does not open
that page automatically. Do not disable system security checks to work around
an unexplained signature warning.

## Update states

| Update button tooltip | Settings → About button | What it means |
|---|---|---|
| Check for updates | Check for updates | Nothing is pending. Press to check now. |
| Checking for updates… | Checking for updates… | A check is still in progress. |
| Update X ready to download | Download update | A compatible version can be downloaded inside Capsule. |
| Downloading update (N%) | Downloading update · N% | The download is in progress. |
| Update X downloaded. Click to restart and install. | Restart & install | The update is ready; restarting asks first. |
| Download failed for X. Click to retry. | Retry download | The download failed; the update is still offered. |
| Restart failed for X. Click to retry. | Retry restart & install | The restart was refused or failed; the download is kept. |
| Check for updates | Retry update check | The last check failed; About shows why. |
| Capsule X didn’t install. Click to try again. | Retry update | A restart to install came back on the old version. |
| Updates unavailable | Check for updates (dimmed) | This build cannot update itself. |
