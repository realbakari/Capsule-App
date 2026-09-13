# Windows preview

The initial Windows build targets **Windows 10 and Windows 11, x64**. Download
the `.exe` installer from the Capsule release page and choose an installation
folder. It installs for your account, adds Start menu and desktop shortcuts,
and can be removed through Windows Settings. Uninstalling retains your local
conversations and settings.

## Unsigned release

This preview has no publisher-signing certificate. Windows may show an
unknown-publisher or SmartScreen warning. Check the repository, version and
release notes before deciding whether to run it. Published SHA-256 checksums
can detect a corrupted download; they do not authenticate a publisher. Do not
disable Windows security protections to install Capsule.

## Agents and terminals

Install and sign in to a Windows-compatible coding CLI separately. Capsule
detects native executables and command launchers on your PATH, preferring the
Windows launcher when npm installs a Unix shim alongside it. Restart Capsule
after changing PATH. The agent still owns its coding loop and credentials;
Capsule does not install it, supply a subscription, or make a macOS-only CLI
Windows-compatible.

Direct ACP sessions use native Windows processes. WSL-hosted agents, Windows
ARM and remote-controlled browser hosts are not included in this preview.
The Gateway route still requires a configured Gateway and its prerequisites.
Protocol fixtures and the local mock conversation flow are checked on Windows;
every signed-in provider has not been verified there.

Project actions and the built-in terminal use PowerShell. Existing actions
written in zsh or Bash may need a Windows-specific command. File paths with
spaces are supported; changing shell syntax automatically would be unsafe.

Compatible Windows updates use the Windows release feed and ask before
restarting. This initial unsigned release does not establish publisher identity
for later updates. The signed macOS feed remains separate. See [Updating](updating.md).
