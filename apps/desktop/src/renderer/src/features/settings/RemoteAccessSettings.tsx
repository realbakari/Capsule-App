import { useCallback, useEffect, useState } from "react";
import type { CapsuleSettings, RemoteAccessStatus } from "@capsule/shared";

import { useWorkspace } from "../../lib/workspace";
import { SettingRow } from "./controls";

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function RemoteAccessSettings({
  settings,
  patch,
}: {
  settings: CapsuleSettings;
  patch: (input: Partial<CapsuleSettings>) => Promise<void>;
}) {
  const { api } = useWorkspace();
  const [status, setStatus] = useState<RemoteAccessStatus>();
  const [error, setError] = useState<string>();
  const [access, setAccess] = useState<"read" | "control">("read");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (!api.isDesktop) return;
    void (api.remoteStatus() as Promise<RemoteAccessStatus>)
      .then(setStatus)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, [api]);

  useEffect(load, [load, settings.remoteAccess]);
  useEffect(() => {
    const off = api.on("state", (event) => {
      if (event && typeof event === "object" && "command" in event && event.command === "remote-updated") load();
    });
    return () => { off(); };
  }, [api, load]);

  if (!api.isDesktop) return <div className="card"><h3>Browser access</h3><p className="muted">Manage pairing and revoke devices on the host computer.</p></div>;

  return (
    <div className="card">
      <h3>Browser access</h3>
      <p className="muted">
        Pair a browser with this workspace. Read-only access is the default. Conversation control
        can send work to this computer’s agents and answer approvals. This computer must stay awake with Capsule running.
      </p>

      <SettingRow
        label="Who can reach it"
        hint={
          settings.remoteAccess === "network"
            ? "Anything on your network can load the page. Pairing is still required to see anything."
            : settings.remoteAccess === "loopback"
              ? "This computer only."
              : "Off. Nothing is listening."
        }
      >
        <select
          className="field-select"
          value={settings.remoteAccess}
          onChange={(event) =>
            void patch({ remoteAccess: event.target.value as CapsuleSettings["remoteAccess"] })
          }
        >
          <option value="off">Off</option>
          <option value="loopback">This computer</option>
          <option value="network">This network</option>
        </select>
      </SettingRow>

      {status?.error && <p className="settings-keybind-error">{status.error}</p>}
      {error && <p className="settings-keybind-error">{error}</p>}

      {status?.url && (
        <>
          <SettingRow label="Address" hint="Open this on the other device, then pair.">
            <span className="mono">{status.url}</span>
          </SettingRow>
          <SettingRow
            label="Device permission"
            hint={status.controlAvailable ? "Conversation control can cause agents to edit files and run commands under the thread’s permissions. Only pair a device you trust." : "Network HTTP is read-only. For control from another device, use This computer behind a trusted HTTPS proxy."}
          >
            <select className="field-select" aria-label="Device permission" value={access}
              onChange={(event) => setAccess(event.target.value === "control" ? "control" : "read")}>
              <option value="read">Read only</option>
              <option value="control" disabled={!status.controlAvailable}>Conversation control</option>
            </select>
          </SettingRow>
          <SettingRow
            label="Pairing link"
            hint="Single use, valid for five minutes. The holder receives the selected permission for twelve hours. Keep the link private."
          >
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                className="chip"
                type="button"
                disabled={creating || access === "control" && !status.controlAvailable}
                onClick={() => {
                  setCreating(true); setError(undefined);
                  void (api.remotePair(access) as Promise<string>)
                    .then(async (url) => {
                      setStatus((current) => (current ? { ...current, pairingUrl: url } : current));
                      await navigator.clipboard.writeText(url);
                    })
                    .catch((caught: unknown) =>
                      setError(caught instanceof Error ? caught.message : String(caught)),
                    ).finally(() => setCreating(false));
                }}
              >
                Create link
              </button>
            </div>
          </SettingRow>
          {status.pairingUrl && (
            <p className="faint mono remote-pairing-url">
              {status.pairingUrl}
              <br />
              It works once — create another for a second device.
            </p>
          )}

          <div className="nav-label" style={{ paddingLeft: 0, marginTop: "0.75rem" }}>
            Paired devices
          </div>
          {status.devices.length === 0 ? (
            <p className="faint">None yet.</p>
          ) : (
            status.devices.map((device) => (
              <div className="row" key={device.id} style={{ marginTop: 6 }}>
                <div>
                  <b>{device.label}</b>
                  <div className="faint">
                    {device.scopes.join(", ")} · last seen {ago(device.lastSeenAt)}
                  </div>
                </div>
                <button
                  className="danger"
                  type="button"
                  onClick={() => {
                    void api.remoteRevoke(device.id).then(load).catch(() => setError("Could not revoke this device. Try again."));
                  }}
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
