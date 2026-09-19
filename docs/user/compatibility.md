# Supported behavior and current limits

An available control describes what Capsule can request through the selected
agent and runtime route. It is not a promise that every agent supports it or
that an operation succeeded. Check **Capabilities** in the composer and inspect
the result before relying on it.

## Agent connections

The [Agent Client Protocol](https://agentclientprotocol.com/get-started/introduction)
connects a workspace to a coding agent. Some agents implement it directly;
others need an adapter. A listing in the
[agent directory](https://agentclientprotocol.com/get-started/agents) does not
install that adapter or guarantee compatibility with Capsule.

| Area | Available behavior | Important limit |
| --- | --- | --- |
| Direct route | Start an installed native ACP agent on this computer; send text and supported attachments, receive activity and handle reported approvals. | ACP v1 only. No automatic registry installation, sign-in, or provider subscription. |
| Gateway route | Use a configured OpenClaw Gateway and its ACP bridge. | The Gateway host owns execution; a remote Gateway does not use this Mac's files automatically. |
| Native Muse connection | Start an installed Muse CLI locally, with text/images, activity, one-time approvals, Stop, reported models and durable idle-session resume. | Requires a CLI build with session SDK support and its own sign-in. No Gateway route, questionnaire forms, live steering or browser-tool injection. Tested with protocol fixtures, not every signed-in account. |
| Session history | Keep recorded conversations and runs; resume native direct sessions when the agent supports resume or load. | A new process must acknowledge the saved identity. Expired or unsupported sessions require a new conversation; older threads without a saved native identity cannot restore agent history. |
| Live settings | Request supported Gateway changes or change exact agent-reported direct settings. | Direct model/mode choices require a reported selector. Capsule permission profiles are not mapped to agent policies. Direct Steer and live folder changes remain unavailable. |
| Attachments | Direct prompts send native images and embedded text/binary resources, including PDFs, when supported. | At most eight files, 2 MiB each and about 3 MiB combined with prompt text before encoding; the wire limit is 4 MiB. Unsupported or oversized content fails visibly. Gateway delivery depends on its host and bridge. |
| Agent tools | Show the activity and approval details the runtime reports. | Capsule does not expose ACP client filesystem/terminal APIs; workspace file and terminal controls are separate. |
| Delegation | Show structured subagent/task observations and usage when reported. | No independent child-session orchestration; a launch finishing does not prove a child finished. Missing usage is not zero. |

See [providers and credentials](providers.md) for setup and per-route controls.
Optional protocol support is checked at connection time; unsupported features
must not be silently treated as enabled.

## Workspace and browser

- **Changes and verification:** Git-backed turns can retain checkpoints and
  saved diffs. A completed turn or successful tool dispatch does not certify a
  fix. Verification needs a matching saved check and revision evidence.
- **Browser:** manual browsing is available on the desktop. A direct agent
  that advertises HTTP MCP can use the visible page after **Allow agent
  control**. Leaving the panel or switching threads revokes access. Cookies
  are shared across visible Capsule browser pages; thread ownership is not separate
  sign-in isolation. Explicitly started background pages use separate temporary
  profiles and stay running across panel changes for up to 30 minutes. At most
  four can run; each has separate agent-control and paired-viewer sharing grants.
  Recording, profile import, arbitrary-script tools and file uploads are not provided.
- **Page interaction:** tools use references from a recent snapshot of the
  main document. Frames, shadow-root content and rich-text editors are not
  fully supported. Preset preview widths change layout, not the device identity.
- **Remote access:** paired devices can read the workspace and explicitly shared
  background-page snapshots, not send messages, approve work or operate a browser.
  This is not a remote-hosted browser or an interactive video stream.
- **Releases:** macOS Apple Silicon is signed and notarized. Windows 10/11 x64
  has an initial unsigned preview; see [Windows](windows.md) for security and
  provider-testing limits. Updates need compatible release metadata, signing
  where available, and consent before restarting.

These are current boundaries, not release promises. Start with a disposable
project when testing a new harness or permission mode. The
[first-conversation guide](getting-started.md), [preview guide](projects-and-previews.md)
and [update guide](updating.md) describe the supported flows.
