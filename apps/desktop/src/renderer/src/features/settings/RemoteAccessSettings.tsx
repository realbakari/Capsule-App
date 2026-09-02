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

/**
 * Devices that can read this Capsule.
 *
 * A paired device gets one scope: read. It can follow a conversation, a diff
 * and a run — and it cannot send a prompt, run a command, write a file or open
 * a shell, because those channels are a different scope that nothing here
 * hands out.
 */
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

  const load = useCallback(() => {
    void (api.remoteStatus() as Promise<RemoteAccessStatus>)
      .then(setStatus)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, [api]);

  useEffect(load, [load, settings.remoteAccess]);

  return (
    <div className="card">
      <h3>Read from another device</h3>
      <p className="muted">
        Serves this workspace to a browser you pair. A paired device can read — conversations,
        diffs, runs — and nothing else: sending, terminals and commands are not part of what it is
        given.
      </p>

      <SettingRow
        label="Who can reach it"
        hint={
          settings.remoteAccess === "network"
            ? "Anything on your network can load the page. Pairing is still required to see anything."
            : settings.remoteAccess === "loopback"
              ? "This Mac only."
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
          <option value="loopback">This Mac</option>
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
            label="Pairing link"
            hint="Single use, valid for five minutes. Anyone holding it can read this workspace."
          >
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                className="chip"
                type="button"
                onClick={() => {
                  void (api.remotePair() as Promise<string>)
                    .then((url) => {
                      setStatus((current) => (current ? { ...current, pairingUrl: url } : current));
                      void navigator.clipboard.writeText(url);
                    })
                    .catch((caught: unknown) =>
                      setError(caught instanceof Error ? caught.message : String(caught)),
                    );
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
              Copied. It works once — create another for a second device.
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
                    void api.remoteRevoke(device.id).then(load);
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
