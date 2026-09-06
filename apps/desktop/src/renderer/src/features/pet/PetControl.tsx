import { useState } from "react";

/** Explicit show/hide commands do not depend on a stale local visibility toggle. */
export function PetControl() {
  const api = window.capsule;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function show(visible: boolean) {
    setBusy(true); setError(undefined);
    try { await api.togglePet(visible); } catch { setError("Could not change the companion. Try again from this Mac."); }
    finally { setBusy(false); }
  }
  return <div className="pet-setting-control">
    {api?.isDesktop === true ? <div className="actions"><button className="chip" disabled={busy} onClick={() => void show(true)}>Show companion</button><button className="ghost" disabled={busy} onClick={() => void show(false)}>Hide</button></div> : <span className="muted">Available in the desktop app on this Mac.</span>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
