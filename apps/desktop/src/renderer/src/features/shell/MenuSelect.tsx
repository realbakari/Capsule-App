import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ChevronDownIcon } from "./icons";
import { floatingPlacement } from "../../lib/floating-placement";
import { filterMenuOptions } from "../../lib/worktree-base";
import "./menu-select-search.css";

export interface MenuOption {
  id: string;
  label: string;
  /**
   * One line saying what the option does. Permission modes in particular are
   * unguessable from their names alone — "Supervised" and "Full access" do not
   * say what either will refuse.
   */
  detail?: string;
  /** A glyph for the row, so a list of agents is scannable by mark. */
  icon?: ReactNode;
  group?: string;
  disabledReason?: string;
}

export function MenuSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  icon,
  unavailableReason,
  iconOnly = false,
  search,
  footer,
}: {
  value: string;
  options: MenuOption[];
  onChange: (id: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** A glyph in front of the label, for rows where the word alone is ambiguous. */
  icon?: ReactNode;
  unavailableReason?: string;
  iconOnly?: boolean;
  /** A filter field above the options, for lists too long to scan. */
  search?: { label: string; placeholder: string; empty: string };
  /** A note under the options, such as what the default means here. */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchField = useRef<HTMLInputElement>(null);
  const shown = search ? filterMenuOptions(options, query) : options;
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((item) => item.id === value);
  const [pos, setPos] = useState({ left: 0, top: 0, minWidth: 140, maxWidth: 400, maxHeight: 256 });

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      if (!rect.width) { setOpen(false); return; }
      const minWidth = Math.min(Math.max(rect.width, 148), window.innerWidth - 16);
      const width = Math.max(minWidth, pop.current?.getBoundingClientRect().width ?? 0);
      const next = { ...floatingPlacement(rect, { width, height: pop.current?.scrollHeight ?? 256 },
        { width: window.innerWidth, height: window.innerHeight }, { preferAbove: true, maxHeight: 256 }), minWidth };
      setPos((current) => Object.keys(next).every((key) => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root.current);
    if (pop.current) observer.observe(pop.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const selected = pop.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? pop.current?.querySelector<HTMLElement>('[role="option"]');
    selected?.scrollIntoView({ block: "nearest" });
    if (searchField.current) searchField.current.focus({ preventScroll: true });
    else selected?.focus({ preventScroll: true });
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (root.current?.contains(node) || pop.current?.contains(node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
      const typing = event.target === searchField.current;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !(typing && (event.key === "Home" || event.key === "End"))) {
        event.preventDefault();
        const rows = Array.from(pop.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
        if (!rows.length) return;
        const currentIndex = rows.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        rows[nextIndex]?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-select" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`menu-select-trigger${iconOnly ? " menu-select-trigger--icon" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-disabled={Boolean(unavailableReason)}
        aria-description={unavailableReason}
        title={unavailableReason ?? (iconOnly ? ariaLabel : `${ariaLabel}: ${current?.label ?? placeholder ?? "Select"}`)}
        onClick={() => { if (!unavailableReason) setOpen((currentOpen) => !currentOpen); }}
        onKeyDown={(event) => {
          if (!open && !unavailableReason && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); }
        }}
      >
        {iconOnly ? <span aria-hidden>{icon ?? "⋯"}</span> : <>{icon}<span>{current?.label ?? placeholder ?? "Select"}</span><ChevronDownIcon size={12} /></>}
      </button>
      {open && !unavailableReason &&
        createPortal(
          <div
            ref={pop}
            id={listId}
            className="menu-select-pop"
            role="listbox"
            aria-label={ariaLabel}
            style={pos}
          >
            {search ? (
              <div className="menu-select-search" role="presentation">
                <input
                  ref={searchField}
                  type="search"
                  aria-label={search.label}
                  placeholder={search.placeholder}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const first = shown.find((item) => !item.disabledReason);
                    if (!first) return;
                    event.preventDefault();
                    onChange(first.id);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                />
              </div>
            ) : null}
            {search && shown.length === 0 ? <p className="menu-select-empty" role="presentation">{search.empty}</p> : null}
            {shown.map((item, index) => (
              <div key={item.id} role="presentation">
              {item.group && item.group !== shown[index - 1]?.group && <div className="menu-option-group" role="presentation">{item.group}</div>}
              <button
                type="button"
                key={item.id}
                role="option"
                tabIndex={-1}
                aria-selected={item.id === value}
                aria-disabled={Boolean(item.disabledReason)}
                className={item.id === value ? "active" : ""}
                onClick={() => {
                  if (item.disabledReason) return;
                  onChange(item.id);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                {item.icon}
                <span className="menu-option-text">
                  <span className="menu-option-label">{item.label}</span>
                  {(item.disabledReason || item.detail) && <span className="menu-option-detail">{item.disabledReason ?? item.detail}</span>}
                </span>
              </button>
              </div>
            ))}
            {footer ? <div className="menu-select-footer" role="presentation">{footer}</div> : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
