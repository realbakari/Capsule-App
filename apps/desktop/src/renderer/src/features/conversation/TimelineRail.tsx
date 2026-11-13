import { useEffect, useState, type RefObject } from "react";
import type { Turn } from "../../lib/turns";
import { turnPreview } from "../../lib/turns";
import type { TurnLayout } from "./VirtualTurns";
import "./timeline-rail.css";

/** Under this many turns, or a thread that nearly fits, the rail is noise. */
const MIN_TURNS = 4;

/**
 * A thin rail beside a long transcript: one mark per turn, as tall as its
 * share of the thread, with the visible part outlined. Hover names the turn;
 * a click jumps to it. A pointer aid only; find in conversation is the
 * keyboard way through a thread.
 */
export function TimelineRail({ scroller, turns, layout }: { scroller: RefObject<HTMLDivElement | null>; turns: readonly Turn[]; layout?: TurnLayout }) {
  const [view, setView] = useState({ top: 0, height: 0, scroll: 1, offsetTop: 0 });
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView({ top: root.scrollTop, height: root.clientHeight, scroll: root.scrollHeight, offsetTop: root.offsetTop }));
    };
    read();
    root.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(root);
    return () => { cancelAnimationFrame(frame); root.removeEventListener("scroll", read); observer.disconnect(); };
  }, [scroller, layout]);

  if (!layout || turns.length < MIN_TURNS || view.scroll < view.height * 1.5) return null;
  const byId = new Map(turns.map((turn, index) => [turn.id, { turn, index }]));
  const scale = (value: number) => `${(value / view.scroll) * 100}%`;
  return (
    <div className="timeline-rail" aria-hidden style={{ top: view.offsetTop + 8, height: view.height - 16 }}>
      <div className="timeline-rail-window" style={{ top: scale(view.top), height: scale(view.height) }} />
      {layout.rows.map((row) => {
        const entry = byId.get(row.id);
        if (!entry) return null;
        const preview = turnPreview(entry.turn, 90).prompt ?? "Turn";
        return (
          <button
            key={row.id}
            type="button"
            tabIndex={-1}
            className="timeline-rail-mark"
            style={{ top: scale(layout.listOffset + row.top), height: scale(row.height) }}
            title={`Turn ${entry.index + 1}: ${preview}`}
            onClick={() => scroller.current?.scrollTo({ top: Math.max(0, layout.listOffset + row.top - 16), behavior: "smooth" })}
          />
        );
      })}
    </div>
  );
}
