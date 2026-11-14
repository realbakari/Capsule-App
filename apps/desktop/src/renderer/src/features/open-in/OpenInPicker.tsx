import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { favoriteOpenInApp, OPEN_IN_DEFAULT_APP, orderOpenInApps, type OpenInApp, type OpenInTarget } from "@capsule/shared";
import { shortcutLabel } from "../../lib/keybindings";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { HeaderPopover } from "../shell/HeaderPopover";
import { ChevronDownIcon, ExternalLinkIcon, PlusIcon, SettingsIcon, StarIcon } from "../shell/icons";
import { useOpenIn, useOpenInCatalog } from "./useOpenIn";
import "./open-in.css";

/** The favourite's chord as the user has it bound, for the button and the shortcuts list. */
export function useOpenInChord(): string {
  const { keyBindings } = useWorkspace();
  return shortcutLabel("open-in-favorite", keyBindings) ?? "";
}

export function AppIcon({ app }: { app: Pick<OpenInApp, "icon" | "name"> }) {
  return app.icon
    ? <img className="open-in-icon" src={app.icon} alt="" draggable={false} />
    : <span className="open-in-icon open-in-icon-blank" aria-hidden><ExternalLinkIcon size={12} /></span>;
}

/**
 * The list of apps, as a menu: arrow keys move, Enter opens, typing a letter
 * jumps to the app that starts with it. Choosing an app makes it the favourite.
 */
function OpenInPicker({ anchor, target, what, state, onClose }: {
  anchor: RefObject<HTMLDivElement | null>;
  target: OpenInTarget;
  /** "folder" or "file", for the empty state and labels. */
  what: "folder" | "file";
  state: ReturnType<typeof useOpenInCatalog>;
  onClose: () => void;
}) {
  const { api, setView, setSettingsTab, setNotice } = useWorkspace();
  const openIn = useOpenIn();
  const chord = useOpenInChord();
  const menu = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const apps = state.catalog ? orderOpenInApps(state.catalog) : [];
  const favorite = favoriteOpenInApp(state.catalog);
  const hasApps = apps.length > 0;
  /* Opened before the list arrived, focus sat on Add app; move it to the first app once there is one. */
  useEffect(() => {
    if (!hasApps) return;
    const first = menu.current?.querySelector<HTMLElement>("[role='menuitem']");
    if (document.activeElement === menu.current?.querySelector("[data-name='Add app']") || !menu.current?.contains(document.activeElement)) first?.focus({ preventScroll: true });
  }, [hasApps]);

  const choose = (app: OpenInApp) => {
    onClose();
    void openIn(app.id, target);
  };
  const add = async () => {
    setAdding(true);
    try {
      if (await api.addOpenInApp()) state.reload();
    } catch (error) {
      setNotice(formatUserError(error));
    } finally { setAdding(false); }
  };
  const manage = () => {
    onClose();
    setSettingsTab("projects");
    setView("settings");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (next: number) => { event.preventDefault(); items[(next + items.length) % items.length]?.focus(); };
    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index < 0 ? items.length - 1 : index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(items.length - 1);
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const letter = event.key.toLowerCase();
      const start = index + 1;
      const order = [...items.slice(start), ...items.slice(0, start)];
      const match = order.find((item) => item.dataset.name?.toLowerCase().startsWith(letter));
      if (match) { event.preventDefault(); match.focus(); }
    }
  };

  return (
    <HeaderPopover anchor={anchor} label={`Open this ${what} in`} className="open-in-picker" onClose={onClose}>
      <div ref={menu} role="menu" aria-label={`Open this ${what} in`} aria-busy={state.status === "loading"} onKeyDown={onKeyDown}>
        <p className="open-in-heading">Open {what} in</p>
        {apps.map((app) => (
          <button key={app.id} type="button" role="menuitem" className="open-in-item" data-name={app.name} title={app.id === OPEN_IN_DEFAULT_APP ? undefined : app.id} onClick={() => choose(app)}>
            <AppIcon app={app} />
            <span className="open-in-name">{app.name}</span>
            {app.id === favorite?.id ? (
              <span className="open-in-favorite" title="Favourite. The shortcut opens it.">
                <StarIcon size={11} />
                <kbd>{chord}</kbd>
              </span>
            ) : null}
          </button>
        ))}
        {state.status === "loading" && apps.length === 0 ? <p className="open-in-note" role="status">Asking the system which apps can open this…</p> : null}
        {state.status === "error" ? <p className="open-in-note open-in-error" role="alert">{state.error}</p> : null}
        {state.status === "ready" && apps.length === 0 ? (
          <p className="open-in-note">
            {state.catalog.discovery === "system"
              ? `The system reports no apps for this ${what}. Add one you use.`
              : "This system does not list apps that open folders. Add one you use."}
          </p>
        ) : null}
        <div className="open-in-footer">
          <button type="button" role="menuitem" className="open-in-item" data-name="Add app" disabled={adding} onClick={() => void add()}>
            <span className="open-in-icon open-in-icon-glyph" aria-hidden><PlusIcon size={13} /></span>
            <span className="open-in-name">{adding ? "Choosing an app…" : "Add app…"}</span>
          </button>
          <button type="button" role="menuitem" className="open-in-item" data-name="Manage" onClick={manage}>
            <span className="open-in-icon open-in-icon-glyph" aria-hidden><SettingsIcon size={13} /></span>
            <span className="open-in-name">Manage apps</span>
          </button>
        </div>
      </div>
    </HeaderPopover>
  );
}

/**
 * A split button: the favourite on the left, the list on the right. With no
 * favourite yet, the whole control opens the list.
 */
export function OpenInControl({ target, what, variant, startOpen }: {
  target: OpenInTarget | undefined;
  what: "folder" | "file";
  /** `row` sits in Conversation details; `bar` sits in a surface's header. */
  variant: "row" | "bar";
  /** Mounted by the shortcut when there is no favourite yet: show the list straight away. */
  startOpen?: boolean;
}) {
  const { api } = useWorkspace();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // After mount, so the list stacks above the popover this control sits in.
  useEffect(() => { if (startOpen) setOpen(true); }, [startOpen]);
  const state = useOpenInCatalog(target, Boolean(target));
  const openIn = useOpenIn();
  const chord = useOpenInChord();
  if (!target || api.isDesktop === false) return null;
  const favorite = favoriteOpenInApp(state.catalog);
  const primaryLabel = favorite ? `Open in ${favorite.name}` : "Open in…";

  return (
    <div className={`open-in-control open-in-${variant}`} ref={anchor}>
      <button
        type="button"
        className="open-in-primary"
        title={favorite ? `Open this ${what} in ${favorite.name} (${chord})` : `Choose an app to open this ${what} in`}
        aria-haspopup={favorite ? undefined : "menu"}
        aria-expanded={favorite ? undefined : open}
        onClick={() => { if (favorite) void openIn(favorite.id, target); else setOpen((value) => !value); }}
      >
        {favorite ? <AppIcon app={favorite} /> : <span className="open-in-icon open-in-icon-glyph" aria-hidden><ExternalLinkIcon size={14} /></span>}
        <span className="open-in-name">{primaryLabel}</span>
        {favorite && variant === "row" ? <kbd className="open-in-kbd">{chord}</kbd> : null}
      </button>
      {favorite ? (
        <button
          type="button"
          className="open-in-more"
          title="Choose another app"
          aria-label={`Choose an app to open this ${what} in`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDownIcon size={12} />
        </button>
      ) : null}
      {open ? <OpenInPicker anchor={anchor} target={target} what={what} state={state} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
