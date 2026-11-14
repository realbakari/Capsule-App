import { useState } from "react";
import { OPEN_IN_DEFAULT_APP, orderOpenInApps, type CapsuleSettings, type OpenInApp } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { PlusIcon, StarIcon } from "../shell/icons";
import { AppIcon, useOpenInChord } from "./OpenInPicker";
import { useOpenInCatalog } from "./useOpenIn";
import "./open-in.css";

/** Settings › Projects: the apps Open in offers for folders, the favourite, and the way to add or remove one. */
export function OpenInSettings() {
  const { api, settings, updateSettings } = useWorkspace();
  const state = useOpenInCatalog(undefined);
  const chord = useOpenInChord();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const apps = state.catalog ? orderOpenInApps(state.catalog) : [];

  const save = async (patch: Partial<CapsuleSettings>) => {
    setError(undefined);
    try { await updateSettings(patch); } catch (caught) { setError(formatUserError(caught)); }
  };
  const add = async () => {
    setBusy(true);
    setError(undefined);
    try { if (await api.addOpenInApp()) state.reload(); } catch (caught) { setError(formatUserError(caught)); } finally { setBusy(false); }
  };
  const remove = (app: OpenInApp) => void save({
    ...(app.added
      ? { openInApps: (settings?.openInApps ?? []).filter((id) => id !== app.id) }
      : { openInHidden: [...(settings?.openInHidden ?? []), app.id] }),
    ...(settings?.openInFavorite === app.id ? { openInFavorite: undefined } : {}),
  });

  // A paired viewer has no apps of its own to open the host's files in.
  if (api.isDesktop === false) return null;
  return (
    <div className="card open-in-settings">
      <h3>Open in</h3>
      <p className="muted">
        Apps that can open a project folder or file, as {state.catalog?.discovery === "manual" ? "you add them" : "the system reports them, plus any you add"}.
        Choosing one makes it the favourite, which {chord} opens the conversation’s folder in.
      </p>
      {state.status === "loading" && apps.length === 0 ? <p className="faint" role="status">Asking the system which apps can open folders…</p> : null}
      {state.status === "error" ? <p className="notice" role="alert">{state.error}</p> : null}
      {state.status === "ready" && apps.length === 0 ? <p className="faint">No apps yet. Add one you use.</p> : null}
      {apps.length > 0 ? (
        <ul className="open-in-settings-list" aria-label="Open in apps">
          {apps.map((app) => {
            const favorite = app.id === state.catalog?.favorite;
            return (
              <li key={app.id} className="open-in-settings-row">
                <AppIcon app={app} />
                <span className="open-in-settings-copy">
                  <span className="open-in-name">{app.name}</span>
                  <span className="faint mono truncate">
                    {app.id === OPEN_IN_DEFAULT_APP ? "The system’s default for each item" : formatProjectRoot(app.id, { home: window.capsule?.homeDir })}
                    {app.added ? " · added" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className={`icon-btn open-in-star${favorite ? " active" : ""}`}
                  aria-pressed={favorite}
                  aria-label={favorite ? `${app.name} is the favourite` : `Make ${app.name} the favourite`}
                  title={favorite ? "Favourite. Click to clear." : "Make favourite"}
                  onClick={() => void save({ openInFavorite: favorite ? undefined : app.id })}
                >
                  <StarIcon size={14} />
                </button>
                <button type="button" className="ghost" onClick={() => remove(app)}>Remove</button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => void add()}>
          <PlusIcon size={12} /> {busy ? "Choosing an app…" : "Add app…"}
        </button>
        {state.catalog?.hidden ? (
          <button type="button" className="ghost" onClick={() => void save({ openInHidden: [] })}>
            Show {state.catalog.hidden} removed {state.catalog.hidden === 1 ? "app" : "apps"}
          </button>
        ) : null}
      </div>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </div>
  );
}
