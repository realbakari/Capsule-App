import { useCallback, useEffect, useMemo, useState } from "react";
import type { CapsuleSettings, RemoteAccessStatus } from "@capsule/shared";
import { encode } from "uqr";

import { deviceLabel } from "../../lib/device-label";
import { useWorkspace } from "../../lib/workspace";
import { SettingRow } from "./controls";
import { ShareSettings } from "../share/ShareSettings";

type PairedDevice = RemoteAccessStatus["devices"][number];

function span(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)} days`;
}

function ago(timestamp: number, now = Date.now()): string {
  return now - timestamp < 60_000 ? "just now" : `${span(now - timestamp)} ago`;
}

/** What a device can do, in the words the pairing controls use. */
export function deviceSummary(device: PairedDevice, now = Date.now()): string {
  const access = device.scopes.includes("control") ? "Conversation control" : "Read only";
  const parts = [device.transport === "phone" ? `Phone, encrypted · ${access}` : access, `last active ${ago(device.lastSeenAt, now)}`];
  /* Phones stay paired until revoked; a browser link lasts twelve hours. */
  if (device.expiresAt - now < 7 * 86_400_000) parts.push(device.expiresAt <= now ? "expired" : `expires in ${span(device.expiresAt - now)}`);
  return parts.join(" · ");
}

const REACH_HINT: Record<CapsuleSettings["remoteAccess"], string> = {
  network: "Anything on your network can load the page. Pairing is still required to see anything.",
  loopback: "This computer only.",
  off: "Off. Nothing is listening.",
};

export function RemoteAccessSettings({
  settings,
  patch,
}: {
  settings: CapsuleSettings;
  patch: (input: Partial<CapsuleSettings>) => Promise<void>;
}) {
  const { api, setConfirm } = useWorkspace();
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
  /* Control chosen on This computer is not on offer once the reach is This network: fall back to read. */
  const controlAvailable = Boolean(status?.controlAvailable);
  useEffect(() => { if (!controlAvailable) setAccess("read"); }, [controlAvailable]);
  useEffect(() => {
    const off = api.on("state", (event) => {
      if (event && typeof event === "object" && "command" in event && event.command === "remote-updated") load();
    });
    return () => { off(); };
  }, [api, load]);

  if (!api.isDesktop) return <div className="card"><h3>Remote access</h3><p className="muted">Manage pairing and revoke devices on the host computer.</p></div>;

  return (
    <>
    <div className="card">
      <h3>Remote access</h3>
      <p className="muted">
        Use this workspace from a browser or the Capsule mobile app. Read-only access is the default. Conversation control
        can send work to this computer’s agents and answer approvals. This computer must stay awake with Capsule running.
      </p>

      <SettingRow
        label="Who can reach it" setting="remoteAccess"
        hint={status?.heldByLaunch
          ? `${REACH_HINT[status.reach]} Capsule was started with remote access on, so this stays until Capsule quits.`
          : REACH_HINT[settings.remoteAccess]}
      >
        <select
          className="field-select"
          aria-label="Who can reach it"
          value={status?.heldByLaunch ? status.reach : settings.remoteAccess}
          disabled={status?.heldByLaunch}
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
            label="Browser link permission"
            hint={status.controlAvailable
              ? "Conversation control can cause agents to edit files and run commands under the thread’s permissions. Only pair a device you trust."
              : status.phoneAvailable && status.reach === "network"
                ? "For the pairing link below. A browser on this network is read-only, because plain HTTP can be read by anyone on it. A phone paired with Pair a phone always gets conversation control: the mobile app connects encrypted."
                : "Network HTTP is read-only. For control from another device, use This computer behind a trusted HTTPS proxy."}
          >
            <select className="field-select" aria-label="Browser link permission" value={access}
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
                      await navigator.clipboard.writeText(url).catch(() => setError("The link is below. Copy it by hand."));
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
          {status.phoneAvailable && <PhonePairing local={status.reach !== "network"} create={() => api.remotePair("phone") as Promise<string>} />}
          {status.pairingUrl && (
            <p className="faint mono remote-pairing-url">
              {status.pairingUrl}
              <br />
              It works once. Create another for a second device.
            </p>
          )}

        </>
      )}
    </div>
    <div className="card">
      <h3>Paired devices</h3>
      {status?.url ? (
        <PairedDevices
          devices={status.devices}
          revoke={(ids) => Promise.all(ids.map((id) => api.remoteRevoke(id))).then(load, () => setError("Could not revoke every device. Try again."))}
          confirm={setConfirm}
        />
      ) : <p className="faint">Turn on remote access above to pair a device. Turning it off signs every device out.</p>}
      <div className="remote-connections"><ShareSettings /></div>
    </div>
    </>
  );
}

/*
 * Every device holding a pairing, what it may do, and a way to end it. The
 * list is the only place a pairing can be ended before it expires, so it
 * also offers ending all of them at once.
 */
function PairedDevices({ devices, revoke, confirm }: {
  devices: PairedDevice[];
  revoke: (ids: string[]) => Promise<unknown>;
  confirm?: ReturnType<typeof useWorkspace>["setConfirm"];
}) {
  const [busy, setBusy] = useState(false);
  const end = (ids: string[]) => { setBusy(true); void revoke(ids).finally(() => setBusy(false)); };
  const endAll = () => {
    const ids = devices.map((device) => device.id);
    if (!confirm) { end(ids); return; }
    confirm({
      title: `Revoke all ${ids.length} devices?`,
      detail: "Each one is signed out at once and needs a new pairing link or code to come back.",
      confirmLabel: "Revoke all",
      danger: true,
      onConfirm: () => { confirm(undefined); end(ids); },
    });
  };
  if (devices.length === 0) return <p className="faint">None yet. A device appears here once it opens a pairing link or scans a code.</p>;
  return (
    <>
      <div className="remote-devices-heading">
        <span className="faint">{devices.length === 1 ? "1 device can reach this workspace." : `${devices.length} devices can reach this workspace.`}</span>
        {devices.length > 1 && <button className="ghost" type="button" disabled={busy} onClick={endAll}>Revoke all</button>}
      </div>
      {devices.map((device) => (
        <SettingRow key={device.id} label={deviceLabel(device.label)} hint={deviceSummary(device)}>
          <button className="danger" type="button" disabled={busy} aria-label={`Revoke ${deviceLabel(device.label)}`} onClick={() => end([device.id])}>
            Revoke
          </button>
        </SettingRow>
      ))}
    </>
  );
}

/*
 * Pairing the mobile app. The code carries this computer's address and the
 * fingerprint of its own certificate, so the phone connects encrypted and
 * trusts nothing else. Because the channel is encrypted end to end, a phone
 * gets conversation control even on This network.
 */
function PhonePairing({ local, create }: { local: boolean; create: () => Promise<string> }) {
  const [code, setCode] = useState<{ url: string; expiresAt: number }>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);

  const remaining = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const expired = Boolean(code) && remaining === 0;

  return (
    <SettingRow
      label="Phone"
      hint={local
        /* The phone listener answers only 127.0.0.1 here, which a real phone cannot reach. */
        ? "On This computer, only a simulator on this Mac can use the code. To pair a real phone or tablet, choose This network above."
        : "Scan with the Capsule mobile app, or the camera, to pair a phone or tablet. The connection is encrypted and can send messages, stop runs, and answer approvals once. Single use, valid for five minutes."}
    >
      <div className="remote-phone-pairing">
        <div className="actions" style={{ marginTop: 0 }}>
          <button
            className="chip"
            type="button"
            onClick={() => {
              setError(undefined);
              void create()
                .then((url) => { setCode({ url, expiresAt: Date.now() + 5 * 60_000 }); setNow(Date.now()); })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
            }}
          >
            {code ? "New code" : "Pair a phone"}
          </button>
        </div>
        {error && <p className="settings-keybind-error">{error}</p>}
        {code && !expired && (
          <>
            <QrCode value={code.url} label="Phone pairing code" />
            <p className="faint remote-phone-expiry">
              Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}.{" "}
              <button className="chip" type="button" onClick={() => void navigator.clipboard.writeText(code.url)}>Copy link</button>
            </p>
          </>
        )}
        {expired && <p className="faint">That code expired. Create a new one.</p>}
      </div>
    </SettingRow>
  );
}

/** Dark modules on a light tile in both themes, which is what scanners read best. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg className="remote-qr" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#111111" />
    </svg>
  );
}
