import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject, type WheelEvent } from "react";
import { KEY_COMMAND_EVENT, withShortcut } from "../../lib/keybindings";
import { useWorkspace } from "../../lib/workspace";
import type { Turn } from "../../lib/turns";
import { ChevronDownIcon, ChevronUpIcon } from "../shell/icons";
import { MINIMAP_MIN_ITEMS, minimapView, turnMinimap, type MinimapItem, type MinimapView, type RowBox } from "./turn-minimap";
import "./turn-minimap.css";

/** Ticks sit this far apart until the rail runs out of height. */
const TICK_SPACING = 8;
/** Narrower than this beside the column and the rail would sit on the messages. */
const MIN_GUTTER = 48;

interface Layout extends MinimapView {
  height: number;
  shown: boolean;
  atEnd: boolean;
}

const HIDDEN: Layout = { height: 0, shown: false, atEnd: false, inView: [], current: null };

const sameLayout = (a: Layout, b: Layout) =>
  a.height === b.height && a.shown === b.shown && a.atEnd === b.atEnd && a.current === b.current && a.inView.join() === b.inView.join();

/**
 * A tick per prompt along the transcript's left gutter. The turns on screen
 * are lit; hovering or arrowing through the ticks previews a prompt, and a
 * click jumps to it. It shows only when the thread scrolls and the gutter has
 * room for it.
 */
export function TurnMinimap({ turns, scroller, onJump }: {
  turns: readonly Turn[];
  scroller: RefObject<HTMLDivElement | null>;
  onJump: (item: MinimapItem) => void;
}) {
  const { keyBindings } = useWorkspace();
  const model = useMemo(() => turnMinimap(turns), [turns]);
  const [layout, setLayout] = useState<Layout>(HIDDEN);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const ticks = useRef<Array<HTMLButtonElement | null>>([]);
  const live = useRef(model);
  live.current = model;
  const remeasure = useRef<() => void>(undefined);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const view = root.getBoundingClientRect();
      const column = root.querySelector(".thread")?.getBoundingClientRect();
      const rows: RowBox[] = Array.from(root.querySelectorAll<HTMLElement>("[data-virtual-turn]"), (row) => {
        const box = row.getBoundingClientRect();
        return { turnId: row.dataset.virtualTurn!, top: box.top - view.top, bottom: box.bottom - view.top };
      });
      const next: Layout = {
        ...minimapView(live.current, rows, root.clientHeight),
        height: root.clientHeight,
        shown: live.current.items.length >= MINIMAP_MIN_ITEMS
          && root.scrollHeight > root.clientHeight + 1
          && Boolean(column && column.left - view.left >= MIN_GUTTER),
        atEnd: root.scrollHeight - root.scrollTop - root.clientHeight <= 1,
      };
      setLayout((current) => sameLayout(current, next) ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    remeasure.current = schedule;
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    const column = root.querySelector(".thread");
    if (column) resize.observe(column);
    root.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      root.removeEventListener("scroll", schedule);
      remeasure.current = undefined;
    };
  }, [scroller]);
  /* Rows mount and unfold without scrolling or resizing the viewport. */
  useEffect(() => { remeasure.current?.(); });

  const { items } = model;
  const count = items.length;
  const current = layout.current !== null && layout.current < count ? layout.current : null;
  const previous = current === null ? undefined : items[current - 1];
  const next = current === null || layout.atEnd ? undefined : items[current + 1];
  /* The Previous turn and Next turn shortcuts step the same way, whether or not the gutter has room for the rail. */
  const step = useRef<(id: unknown) => void>(undefined);
  step.current = (id) => {
    const target = id === "previous-turn" ? previous : id === "next-turn" ? next : undefined;
    if (target) onJump(target);
  };
  useEffect(() => {
    const onCommand = (event: Event) => step.current?.((event as CustomEvent<{ id?: string }>).detail?.id);
    window.addEventListener(KEY_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(KEY_COMMAND_EVENT, onCommand);
  }, []);
  if (!layout.shown) return null;

  const inView = new Set(layout.inView);
  const previewed = hovered ?? focused;
  const preview = previewed === null ? undefined : items[previewed];
  const percent = (index: number) => (index / (count - 1)) * 100;
  const band = `${100 / (count - 1)}%`;
  const roving = focused ?? current ?? 0;

  const focusTick = (index: number) => ticks.current[Math.max(0, Math.min(count - 1, index))]?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: count - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTick(target);
  };
  /* The rail sits beside the transcript, not in it: a wheel over it still scrolls the thread. */
  const onWheel = (event: WheelEvent) => {
    const root = scroller.current;
    if (!root || event.ctrlKey) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1;
    root.scrollBy({ top: event.deltaY * unit });
  };

  return <div className="turn-minimap-anchor">
    <nav className="turn-minimap" aria-label="Conversation turns" style={{ height: layout.height }} onWheel={onWheel}>
      <div className="turn-minimap-rail" style={{ height: `min(${(count - 1) * TICK_SPACING}px, max(4rem, 100% - 6rem))` }}
        onPointerLeave={() => setHovered(null)}>
        <button type="button" className="icon-btn turn-minimap-step turn-minimap-previous" aria-label="Previous turn" title={withShortcut("Previous turn", "previous-turn", keyBindings)}
          disabled={!previous} onPointerEnter={() => setHovered(null)} onClick={() => previous && onJump(previous)}>
          <ChevronUpIcon size={13} />
        </button>
        {items.map((item, index) => {
          const distance = previewed === null ? undefined : Math.abs(index - previewed);
          return <button key={item.turnId} type="button" className="turn-minimap-tick"
            ref={(node) => { ticks.current[index] = node; }}
            aria-label={`Turn ${item.number}: ${item.prompt.length > 80 ? `${item.prompt.slice(0, 79)}…` : item.prompt}`}
            aria-current={index === current ? "location" : undefined}
            tabIndex={index === roving ? 0 : -1}
            data-in-view={inView.has(index) || undefined}
            data-reach={distance === undefined || distance > 2 ? undefined : distance}
            style={{ top: `calc(${percent(index)}% - ${band} / 2)`, height: band }}
            onPointerEnter={() => setHovered(index)}
            onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible") ? index : null)}
            onBlur={() => setFocused(null)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onJump(item)} />;
        })}
        {preview && <div className="turn-minimap-preview" aria-hidden style={{ top: `${percent(previewed!)}%` }}>
          <span className="turn-minimap-preview-prompt">{preview.prompt}</span>
          {preview.reply && <span className="turn-minimap-preview-reply">{preview.reply}</span>}
        </div>}
        <button type="button" className="icon-btn turn-minimap-step turn-minimap-next" aria-label="Next turn" title={withShortcut("Next turn", "next-turn", keyBindings)}
          disabled={!next} onPointerEnter={() => setHovered(null)} onClick={() => next && onJump(next)}>
          <ChevronDownIcon size={13} />
        </button>
      </div>
    </nav>
  </div>;
}
