import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ActionMenuIcon, ActionMenuItem, MenuAnchor } from "../../lib/action-menu";
import {
  estimateMenuSize,
  nextSelectableIndex,
  placeActionMenu,
  selectableMenuItems,
  typeaheadMenuIndex,
} from "../../lib/action-menu";
import {
  ArchiveIcon,
  CopyIcon,
  FolderIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  TrashIcon,
} from "./icons";

const ICONS: Record<ActionMenuIcon, typeof PencilIcon> = {
  pencil: PencilIcon,
  pin: PinIcon,
  "pin-off": PinOffIcon,
  refresh: RefreshIcon,
  archive: ArchiveIcon,
  trash: TrashIcon,
  plus: PlusIcon,
  folder: FolderIcon,
  copy: CopyIcon,
  settings: SettingsIcon,
};

export function ActionMenu({
  items,
  point,
  anchor,
  keyboard,
  onClose,
  onSelect,
}: {
  items: ActionMenuItem[];
  point: { x: number; y: number };
  anchor?: MenuAnchor;
  keyboard?: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const onSelectRef = useRef(onSelect);
  onCloseRef.current = onClose;
  onSelectRef.current = onSelect;
  const estimated = estimateMenuSize(items);
  const [pos, setPos] = useState(() =>
    placeActionMenu({
      menuWidth: estimated.width,
      menuHeight: estimated.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pointerX: point.x,
      pointerY: point.y,
      anchor,
    }),
  );
  const selectable = selectableMenuItems(items);
  const [activeId, setActiveId] = useState<string | undefined>(
    keyboard ? selectable[0]?.id : undefined,
  );
  const typeahead = useRef({ query: "", at: 0 });

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    setPos(
      placeActionMenu({
        menuWidth: box.width,
        menuHeight: box.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        pointerX: point.x,
        pointerY: point.y,
        anchor,
      }),
    );
    node.focus({ preventScroll: true });
  }, [anchor, items, point.x, point.y]);

  useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onResize = () => onCloseRef.current();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onResize);
    };
  }, []);

  function activate(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.enabled === false) return;
    onSelectRef.current(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const index = nextSelectableIndex(items, activeId, direction);
      setActiveId(selectable[index]?.id);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveId(selectable[0]?.id);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveId(selectable.at(-1)?.id);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && activeId) {
      event.preventDefault();
      activate(activeId);
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const query = now - typeahead.current.at > 700 ? event.key : `${typeahead.current.query}${event.key}`;
      typeahead.current = { query, at: now };
      const index = typeaheadMenuIndex(items, query, activeId);
      if (index >= 0) setActiveId(selectable[index]?.id);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="action-menu-layer" role="presentation">
      <div className="action-menu-scrim" onPointerDown={() => onCloseRef.current()} />
      <div
        ref={menuRef}
        className="action-menu"
        role="menu"
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {items.map((item) => {
          const Icon = item.icon ? ICONS[item.icon] : undefined;
          const highlighted = item.id === activeId;
          return (
            <div key={item.id}>
              {item.separatorBefore ? <div className="action-menu-sep" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className={item.destructive ? "danger" : undefined}
                data-highlighted={highlighted ? "true" : undefined}
                disabled={item.enabled === false}
                onMouseEnter={() => {
                  if (item.enabled !== false) setActiveId(item.id);
                }}
                onClick={() => activate(item.id)}
              >
                {Icon ? (
                  <span className="action-menu-icon">
                    <Icon size={14} />
                  </span>
                ) : (
                  <span className="action-menu-icon" />
                )}
                <span className="truncate">{item.label}</span>
                {item.shortcut ? <kbd className="action-menu-kbd">{item.shortcut}</kbd> : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
