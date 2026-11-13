import { useEffect, useState } from "react";
import { Switch } from "../settings/controls";

/**
 * Show or hide the companion. The companion can also be hidden from its own
 * window or the menu bar, so the switch reads the real state when it appears,
 * after each change, and whenever this window regains focus, rather than
 * trusting a flag it set itself.
 */
export function PetControl() {
  const api = window.capsule;
  const [visible, setVisible] = useState<boolean>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (api?.isDesktop !== true) return undefined;
    const read = () => { void api.getPetState().then((state) => setVisible(state.visible), () => undefined); };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [api]);
  if (api?.isDesktop !== true) return <span className="muted">Available in the desktop app on this Mac.</span>;
  async function change(next: boolean) {
    setError(undefined);
    setVisible(next);
    try { await api.togglePet(next); } catch { setError("Could not change the companion. Try again."); }
    try { setVisible((await api.getPetState()).visible); } catch { /* Keep the optimistic value. */ }
  }
  return <div className="pet-setting-control">
    <Switch checked={Boolean(visible)} label="Desktop companion" onChange={(next) => void change(next)} />
    {error && <small role="alert">{error}</small>}
  </div>;
}
