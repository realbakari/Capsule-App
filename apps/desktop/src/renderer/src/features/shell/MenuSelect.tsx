import { useEffect, useRef, useState } from "react";

export interface MenuOption {
  id: string;
  label: string;
}

export function MenuSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
}: {
  value: string;
  options: MenuOption[];
  onChange: (id: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((item) => item.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {current?.label ?? placeholder ?? "Select"}
      </button>
      {open && (
        <div className="menu-select-pop" role="listbox">
          {options.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === value ? "active" : ""}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
