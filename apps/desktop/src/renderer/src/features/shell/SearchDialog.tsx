import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatUserError } from "../../lib/errors";
import { SearchIcon, XIcon } from "./icons";

export interface SearchDialogItem {
  id: string;
  label: string;
  detail?: string;
  group: string;
  icon?: ReactNode;
  shortcut?: string;
  disabledReason?: string;
  onSelect: () => unknown;
}

/** Shared keyboard, focus and result geometry for command and file discovery. */
export function SearchDialog({ title, placeholder, query, onQueryChange, items, status, error, onRetry, empty, onClose, selectLabel = "Open" }: {
  title: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  items: SearchDialogItem[];
  status?: string;
  error?: string;
  onRetry?: () => void;
  empty: ReactNode;
  onClose: () => void;
  selectLabel?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const selecting = useRef(false);
  const [selection, setSelection] = useState<{ query: string; id: string }>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const selectedIndex = selection?.query === query ? items.findIndex((item) => item.id === selection.id) : -1;
  const index = selectedIndex >= 0 ? selectedIndex : items.length ? 0 : -1;
  const activeId = index >= 0 ? `${id}-option-${index}` : undefined;

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const node = dialog.current;
    input.current?.focus();
    return () => {
      alive.current = false;
      // Do not steal focus from a new dialog or a destination that focused itself.
      if (previous?.isConnected && !previous.closest("[inert]") &&
        (node?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const selected = activeId ? document.getElementById(activeId) : undefined;
    const list = dialog.current?.querySelector(".palette-list");
    if (!selected || !list) return;
    const reveal = () => selected.scrollIntoView({ block: "nearest" });
    reveal();
    // Zoom and window resizing can clip a selection even without a new query.
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    observer.observe(selected);
    return () => observer.disconnect();
  }, [activeId, items]);

  async function select(item: SearchDialogItem) {
    if (selecting.current || item.disabledReason) return;
    selecting.current = true;
    setBusy(true);
    setActionError(undefined);
    try {
      await item.onSelect();
      if (alive.current) onClose();
    } catch (reason) {
      if (alive.current) setActionError(formatUserError(reason));
    } finally {
      selecting.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <div className="palette-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="palette search-dialog" role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled):not([tabindex="-1"])'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="palette-search-row">
        <SearchIcon size={16} />
        <input ref={input} aria-label={title} role="combobox" aria-expanded="true" aria-autocomplete="list"
          aria-controls={`${id}-list`} aria-activedescendant={activeId} autoComplete="off" spellCheck={false}
          placeholder={placeholder} value={query} readOnly={busy}
          onChange={(event) => { setActionError(undefined); onQueryChange(event.target.value); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              if (!items.length) return;
              const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
              setSelection({ query, id: items[next]!.id });
            }
            if (event.key === "Enter" && items[index]) { event.preventDefault(); void select(items[index]!); }
          }} />
        <button type="button" className="search-dialog-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><XIcon size={15} /></button>
      </div>
      {(error || actionError) && <div className="search-dialog-feedback" role="alert">
        <span>{actionError ?? error}</span>
        {error && onRetry && <button type="button" onClick={onRetry}>Retry</button>}
      </div>}
      {status && <p className="search-dialog-status" role="status">{status}</p>}
      {items.length === 0 && !status && !error && <div className="palette-empty">{empty}</div>}
      <div className="palette-list" id={`${id}-list`} role="listbox" aria-label={`${title} results`} aria-busy={Boolean(status) || busy}>
        {items.map((item, itemIndex) => <div key={item.id} role="presentation">
          {(itemIndex === 0 || items[itemIndex - 1]?.group !== item.group) && <div className="search-dialog-section" role="presentation">{item.group}</div>}
          <button type="button" role="option" id={`${id}-option-${itemIndex}`} tabIndex={-1}
            aria-selected={index === itemIndex} aria-disabled={Boolean(item.disabledReason) || busy}
            className={`search-dialog-item${index === itemIndex ? " active" : ""}`}
            title={item.disabledReason ?? [item.label, item.detail].filter(Boolean).join(" — ")}
            onPointerDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelection({ query, id: item.id })} onClick={() => void select(item)}>
            <span className="search-dialog-icon" aria-hidden>{item.icon}</span>
            <span className="search-dialog-copy"><span>{item.label}</span>{(item.disabledReason || item.detail) && <small>{item.disabledReason ?? item.detail}</small>}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        </div>)}
      </div>
      <div className="palette-hints" aria-hidden><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> {selectLabel}</span><span><kbd>Esc</kbd> Close</span></div>
    </div>
  </div>;
}
