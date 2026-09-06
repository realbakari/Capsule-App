import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ChevronDownIcon } from "./icons";

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
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((item) => item.id === value);
  const [pos, setPos] = useState({ left: 0, top: 0, minWidth: 140, maxHeight: 256 });

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      if (!rect.width) { setOpen(false); return; }
      const minWidth = Math.min(Math.max(rect.width, 148), window.innerWidth - 16);
      const width = Math.max(minWidth, pop.current?.getBoundingClientRect().width ?? 0);
      const above = rect.top - 14;
      const below = window.innerHeight - rect.bottom - 14;
      const useAbove = above >= Math.min(256, below);
      const maxHeight = Math.max(40, Math.min(256, useAbove ? above : below));
      const height = Math.min(pop.current?.scrollHeight ?? maxHeight, maxHeight);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPos({
        left,
        top: useAbove ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
        minWidth,
        maxHeight,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selected = pop.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? pop.current?.querySelector<HTMLElement>('[role="option"]');
    selected?.scrollIntoView({ block: "nearest" });
    selected?.focus({ preventScroll: true });
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
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
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
        title={unavailableReason ?? `${ariaLabel}: ${current?.label ?? placeholder ?? "Select"}`}
        onClick={() => { if (!unavailableReason) setOpen((currentOpen) => !currentOpen); }}
        onKeyDown={(event) => {
          if (!open && !unavailableReason && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); }
        }}
      >
        {iconOnly ? <span aria-hidden>⋯</span> : <>{icon}<span>{current?.label ?? placeholder ?? "Select"}</span><ChevronDownIcon size={12} /></>}
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
            {options.map((item, index) => (
              <div key={item.id} role="presentation">
              {item.group && item.group !== options[index - 1]?.group && <div className="menu-option-group" role="presentation">{item.group}</div>}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
