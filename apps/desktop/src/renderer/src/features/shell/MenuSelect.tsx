import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
}

export function MenuSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  icon,
}: {
  value: string;
  options: MenuOption[];
  onChange: (id: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** A glyph in front of the label, for rows where the word alone is ambiguous. */
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const current = options.find((item) => item.id === value);
  const [pos, setPos] = useState({ left: 0, bottom: 0, minWidth: 140 });

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const minWidth = Math.max(rect.width, 148);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - minWidth - 8);
      setPos({
        left,
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
        minWidth,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (root.current?.contains(node) || pop.current?.contains(node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
        type="button"
        className="menu-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        {icon}
        <span>{current?.label ?? placeholder ?? "Select"}</span>
        <ChevronDownIcon size={12} />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="menu-select-pop"
            role="listbox"
            aria-label={ariaLabel}
            style={{ left: pos.left, bottom: pos.bottom, minWidth: pos.minWidth }}
          >
            {options.map((item) => (
              <button
                type="button"
                key={item.id}
                role="option"
                aria-selected={item.id === value}
                className={item.id === value ? "active" : ""}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
              >
                {item.icon}
                <span className="menu-option-text">
                  <span className="menu-option-label">{item.label}</span>
                  {item.detail && <span className="menu-option-detail">{item.detail}</span>}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
