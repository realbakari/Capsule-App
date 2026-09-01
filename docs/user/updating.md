# Updating Capsule

The refresh button at the bottom-right of the sidebar checks whether a newer
version has been published. Hover it to see what it found; when an update is
available, clicking it opens the release page.

Capsule does not install updates for you. Replacing a running app in place
requires the new build to be signed and notarised with the same identity as the
one already installed — otherwise macOS refuses to launch it. Capsule's builds
are not signed, so an in-place updater would download something your Mac would
then block. Downloading the release and replacing the app yourself is the
honest path until that changes.

## What the check can tell you

| What you see | What it means |
|---|---|
| Up to date | The newest published release matches the version you are running. |
| Version *x* is available | A newer release exists. Click to open it. |
| No releases have been published yet | Nothing has been published, or the repository is not public. |
| Could not check | The request failed — usually no network. |
