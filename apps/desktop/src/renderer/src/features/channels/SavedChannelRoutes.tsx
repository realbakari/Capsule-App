import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SavedChannelRoute } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { XIcon } from "../shell/icons";

export function SavedChannelRoutes() {
  const { api, projects } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [routes, setRoutes] = useState<SavedChannelRoute[]>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    dialog.current?.showModal();
    setRoutes(undefined); setSelected(undefined); setError(undefined);
    void api.listSavedChannelRoutes().then((next) => { if (active) setRoutes(next); }, (reason) => { if (active) setError(formatUserError(reason)); });
    return () => { active = false; trigger.current?.focus(); };
  }, [api, open]);
  if (!api.isDesktop || !api.listSavedChannelRoutes) return null;
  return <><button ref={trigger} type="button" className="ghost" onClick={() => setOpen(true)}>Saved channel harnesses</button>
    {open && createPortal(<dialog ref={dialog} className="channel-dialog" aria-label="Saved channel harnesses" onCancel={(event) => { event.preventDefault(); if (!busy) setOpen(false); }}>
      <header><h2>Saved channel harnesses</h2><button className="icon-btn" aria-label="Close saved harnesses" disabled={busy} onClick={() => setOpen(false)}><XIcon size={18} /></button></header>
      <p className="channels-hint">Remove unused local connections to free a slot. Project conversations and relay channels are kept.</p>
      {error && <p role="alert" className="channels-error">{error}</p>}
      {!routes && !error ? <p role="status">Loading saved harnesses…</p> : null}
      {routes?.length === 0 && <p>No saved channel harnesses.</p>}
      <ul className="channel-saved-routes">{routes?.map((route) => <li key={route.id}>
        <strong>{projects.find((project) => project.id === route.configuration.projectId)?.name ?? "Unavailable project"} · {route.configuration.harnessId}</strong>
        <p>{route.url}</p><p className="channel-id">Channel {route.configuration.channelId}<br />Identity {route.identity.slice(0, 12)}…{route.identity.slice(-6)}</p>
        <p>{route.configuration.enabled ? "Enabled" : "Paused"}</p>
        {!route.removable && <p className="channels-hint">Pause the route and finish or stop its active run before removing it.</p>}
        {selected === route.id ? <><p>Remove this local connection? Future messages will not run until you connect it again.</p><button className="ghost" disabled={busy} onClick={() => setSelected(undefined)}>Cancel</button><button className="ghost channel-destructive" disabled={busy} onClick={async () => {
          setBusy(true); setError(undefined);
          try { await api.removeChannelRoute(route.id); setRoutes(await api.listSavedChannelRoutes()); setSelected(undefined); }
          catch (reason) { setError(formatUserError(reason)); }
          finally { setBusy(false); }
        }}>Confirm removal</button></> : <button className="ghost" disabled={busy || !route.removable} onClick={() => setSelected(route.id)}>Remove local connection</button>}
      </li>)}</ul>
    </dialog>, document.body)}
  </>;
}
