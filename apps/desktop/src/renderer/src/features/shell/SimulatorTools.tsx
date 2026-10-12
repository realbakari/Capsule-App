import { useEffect, useState } from "react";
import type { SimulatorAction, SimulatorApp, SimulatorDeviceSettings } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";

const PRIVACY_SERVICES = ["location", "location-always", "photos", "photos-add", "contacts", "contacts-limited", "calendar", "reminders", "microphone", "motion", "media-library", "siri", "all"];

/**
 * Everything on the device that is a setting rather than a gesture. Each
 * control is one action, and every value shown is read back from the device
 * after a change rather than assumed.
 */
export function SimulatorTools({ udid, apps, touchReady, agentAccess, onDetach, act, onClose }: {
  udid: string;
  apps: SimulatorApp[] | undefined;
  touchReady: boolean;
  agentAccess: boolean;
  onDetach: () => void;
  act: (action: SimulatorAction, label?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { api, setNotice } = useWorkspace();
  const [settings, setSettings] = useState<SimulatorDeviceSettings>();
  const [error, setError] = useState<string>();
  const [latitude, setLatitude] = useState("37.3349");
  const [longitude, setLongitude] = useState("-122.00902");
  const [pushApp, setPushApp] = useState("");
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [privacyApp, setPrivacyApp] = useState("");
  const [privacyService, setPrivacyService] = useState("location");
  const userApps = (apps ?? []).filter((app) => app.type === "User");

  const read = () => {
    void api.readSimulatorSettings(udid).then((next) => { setSettings(next); setError(undefined); }).catch((reason) => setError(formatUserError(reason)));
  };
  useEffect(read, [api, udid]);
  useEffect(() => {
    if (!pushApp && userApps[0]) setPushApp(userApps[0].bundleId);
    if (!privacyApp && userApps[0]) setPrivacyApp(userApps[0].bundleId);
  }, [privacyApp, pushApp, userApps]);

  const change = (action: SimulatorAction, label?: string) => void act(action, label).then(read);

  return (
    <div className="simulator-tools" role="dialog" aria-label="Simulator tools">
      <div className="browser-controls-heading"><strong>Tools</strong><button type="button" className="ghost" onClick={onClose}>Close</button></div>
      {error && <p className="error-text">{error}</p>}

      <section>
        <h5>Appearance</h5>
        <div className="simulator-tools-row">
          <button type="button" className="chip" aria-pressed={settings?.appearance === "light"} onClick={() => change({ type: "appearance", style: "light" })}>Light</button>
          <button type="button" className="chip" aria-pressed={settings?.appearance === "dark"} onClick={() => change({ type: "appearance", style: "dark" })}>Dark</button>
        </div>
      </section>

      <section>
        <h5>Text size</h5>
        <div className="simulator-tools-row">
          <button type="button" className="chip" aria-label="Smaller text" onClick={() => change({ type: "contentSize", size: "decrement" })}>−</button>
          <span className="mono simulator-tools-value">{settings?.contentSize ?? "…"}</span>
          <button type="button" className="chip" aria-label="Larger text" onClick={() => change({ type: "contentSize", size: "increment" })}>+</button>
        </div>
        <label className="simulator-tools-check">
          <input type="checkbox" checked={settings?.increaseContrast ?? false} onChange={(event) => change({ type: "contrast", enabled: event.target.checked })} />
          Increase contrast
        </label>
      </section>

      <section>
        <h5>Rotation</h5>
        {touchReady ? (
          <div className="simulator-tools-row">
            {([["portrait", "Portrait"], ["landscapeLeft", "Landscape left"], ["landscapeRight", "Landscape right"]] as const).map(([orientation, label]) => (
              <button key={orientation} type="button" className="chip" aria-pressed={settings?.orientation === orientation} onClick={() => change({ type: "rotate", orientation })}>{label}</button>
            ))}
          </div>
        ) : <p className="faint">Rotation needs touch input to be connected.</p>}
      </section>

      <section>
        <h5>Status bar</h5>
        <div className="simulator-tools-row">
          <button type="button" className="chip" onClick={() => change({ type: "statusBar", mode: "clean" })}>Clean 9:41</button>
          <button type="button" className="chip" onClick={() => change({ type: "statusBar", mode: "clear" })}>Clear override</button>
        </div>
      </section>

      <section>
        <h5>Location</h5>
        <form className="simulator-tools-row" onSubmit={(event) => {
          event.preventDefault();
          const lat = Number(latitude), lon = Number(longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) { setNotice("Enter a latitude and a longitude."); return; }
          change({ type: "location", latitude: lat, longitude: lon });
        }}>
          <input className="preview-address-input" aria-label="Latitude" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="Latitude" />
          <input className="preview-address-input" aria-label="Longitude" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="Longitude" />
          <button type="submit" className="chip">Set</button>
          <button type="button" className="chip" onClick={() => change({ type: "clearLocation" })}>Clear</button>
        </form>
      </section>

      <section>
        <h5>Push notification</h5>
        {userApps.length === 0 ? <p className="faint">Install one of your apps first.</p> : (
          <form className="simulator-tools-stack" onSubmit={(event) => {
            event.preventDefault();
            change({ type: "push", bundleId: pushApp, title: pushTitle, body: pushBody }, "push");
          }}>
            <select className="preview-viewport" aria-label="App to notify" value={pushApp} onChange={(event) => setPushApp(event.target.value)}>
              {userApps.map((app) => <option key={app.bundleId} value={app.bundleId}>{app.name}</option>)}
            </select>
            <input className="preview-address-input" aria-label="Notification title" value={pushTitle} onChange={(event) => setPushTitle(event.target.value)} placeholder="Title" />
            <input className="preview-address-input" aria-label="Notification body" value={pushBody} onChange={(event) => setPushBody(event.target.value)} placeholder="Body" />
            <button type="submit" className="chip" disabled={!pushApp || (!pushTitle.trim() && !pushBody.trim())}>Send</button>
          </form>
        )}
      </section>

      <section>
        <h5>Permissions</h5>
        {userApps.length === 0 ? <p className="faint">Install one of your apps first.</p> : (
          <div className="simulator-tools-stack">
            <select className="preview-viewport" aria-label="App for permissions" value={privacyApp} onChange={(event) => setPrivacyApp(event.target.value)}>
              {userApps.map((app) => <option key={app.bundleId} value={app.bundleId}>{app.name}</option>)}
            </select>
            <select className="preview-viewport" aria-label="Permission" value={privacyService} onChange={(event) => setPrivacyService(event.target.value)}>
              {PRIVACY_SERVICES.map((service) => <option key={service} value={service}>{service}</option>)}
            </select>
            <div className="simulator-tools-row">
              <button type="button" className="chip" onClick={() => change({ type: "privacy", action: "grant", service: privacyService, bundleId: privacyApp })}>Grant</button>
              <button type="button" className="chip" onClick={() => change({ type: "privacy", action: "revoke", service: privacyService, bundleId: privacyApp })}>Revoke</button>
              <button type="button" className="chip" onClick={() => change({ type: "privacy", action: "reset", service: privacyService, bundleId: privacyApp })}>Reset</button>
            </div>
            <p className="faint">Changing a permission may quit the app if it is running.</p>
          </div>
        )}
      </section>

      <section>
        <h5>Agent access</h5>
        <p className="faint">{agentAccess ? "This conversation’s agent can see and drive this simulator while it stays attached." : "Agent simulator access is off in Settings. You can still watch and tap."}</p>
        <button type="button" className="chip" onClick={onDetach}>Detach simulator</button>
      </section>
    </div>
  );
}
