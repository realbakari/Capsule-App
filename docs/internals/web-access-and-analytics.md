# Browser control

## Host boundary

The same renderer is served by `@capsule/remote`. There is no hosted execution
service or replacement agent runtime. Direct work stays in the host's installed
CLI; Gateway threads keep their route and execute wherever that Gateway runs.

The existing `read` grants are unchanged. The new `control` grant adds exactly
`createSession`, `sendMessage`, `stopRun`, and `resolveApproval`. It cannot mint
grants, change settings, write files directly, attach local paths, administer
channels, or open a terminal. New conversations target an existing project and
are forced to local workspace mode and strict permissions. Approval decisions
are once-only or deny. Existing conversations retain their host permissions.
Agents may still execute commands and edit files under those permissions.

Unknown channels default to denied. Scope checks run before main's validated
argument projection. Socket expiry and revocation recheck queued execution and
outbound replies. Revocation blocks new work, but does not cancel an already
accepted run. Reconnection refreshes state and never replays uncertain writes.

## HTTPS deployment

For a browser on the host, use Settings → Gateway → Browser access → This
computer. For another device, terminate HTTPS using a trusted reverse proxy or
private-network tunnel on the same host. Start Capsule with:

```sh
CAPSULE_REMOTE_PUBLIC_URL=https://capsule.example.com \
CAPSULE_REMOTE_PORT=51101 \
/Applications/Capsule.app/Contents/MacOS/Capsule --remote --no-open
```

Proxy that origin's `/`, `/pair`, and WebSocket `/rpc` to
`http://127.0.0.1:51101`. Preserve the browser Origin and either the public Host
or the upstream Host. Use a valid TLS certificate. Do not bind the upstream
listener to the LAN. Do not log pairing request bodies or WebSocket frames.
The URL must be an HTTPS origin with no path, query or credentials. Port is
optional (ephemeral by default); a proxy needs a stable configured port.
Environment changes require restarting the host.

The server does not trust forwarded-protocol headers. It requires the configured
Origin and a loopback peer for proxied control. Cross-origin pairing and socket
upgrades are rejected. Plain LAN HTTP grants remain read-only. The UI disables
control pairing on that listener. Tokens remain in URL fragments/session storage,
not query strings; grants expire after five minutes and devices after twelve hours.

This is a host-served web workspace, not a centrally hosted account portal.
Managed tunnels, automatic host discovery, a background service independent of
Electron, and multi-host account login are not part of this change. Hosting the
marketing renderer alone does not expose a user's machine.
