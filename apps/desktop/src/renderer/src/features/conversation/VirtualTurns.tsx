import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Turn } from "../../lib/turns";
import { localTimings } from "@capsule/shared";

const OVERSCAN = 700;

/** Variable-height rows. Measurements and focus belong to stable turn IDs. */
export function VirtualTurns({ turns, folded, scroller, stick, children }: {
  turns: Turn[];
  folded: ReadonlySet<string>;
  scroller: RefObject<HTMLDivElement | null>;
  stick: boolean;
  children: (turn: Turn) => ReactNode;
}) {
  const renderStarted = performance.now();
  const container = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, { folded: boolean; height: number }>());
  const [viewport, setViewport] = useState({ top: 0, height: 900 });
  const [, remeasure] = useState(0);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const previous = useRef<{ id: string; offset: number } | undefined>(undefined);
  const previousLayout = useRef("");
  let total = 0;
  const rows = turns.map((turn) => {
    const measurement = heights.current.get(turn.id);
    const height = measurement?.folded === folded.has(turn.id) ? measurement.height : folded.has(turn.id) ? 68 : 320;
    const row = { turn, top: total, height };
    total += height;
    return row;
  });
  const live = useRef({ rows, folded, stick });
  live.current = { rows, folded, stick };

  // Parent refs are attached after child layout effects. Subscribe after commit.
  useEffect(() => {
    const root = scroller.current;
    const list = container.current;
    if (!root || !list) return;
    let frame = 0;
    const readViewport = () => {
      const top = root.scrollTop - (list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop);
      setViewport((current) => current.top === top && current.height === root.clientHeight ? current : { top, height: root.clientHeight });
      const row = live.current.rows.find((row) => row.top + row.height > top);
      previous.current = row ? { id: row.turn.id, offset: top - row.top } : undefined;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(readViewport); };
    // Keep focused and selected text mounted while the viewport moves away.
    const preserveInteraction = () => {
      const selection = document.getSelection();
      const nodes = [document.activeElement, selection?.anchorNode, selection?.focusNode];
      setPinned(new Set(nodes.flatMap((node) => {
        const element = node instanceof Element ? node : node?.parentElement;
        const row = element?.closest<HTMLElement>("[data-virtual-turn]");
        return row && list.contains(row) ? [row.dataset.virtualTurn!] : [];
      })));
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root.addEventListener("scroll", readViewport, { passive: true });
    document.addEventListener("selectionchange", preserveInteraction);
    document.addEventListener("focusin", preserveInteraction);
    readViewport();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener("scroll", readViewport);
      document.removeEventListener("selectionchange", preserveInteraction);
      document.removeEventListener("focusin", preserveInteraction);
    };
  }, [scroller]);

  useLayoutEffect(() => {
    const root = scroller.current;
    const list = container.current;
    if (!root || !list) return;
    localTimings.record("chat.commit", performance.now() - renderStarted);
    const ids = new Set(turns.map((turn) => turn.id));
    for (const id of heights.current.keys()) if (!ids.has(id)) heights.current.delete(id);
    const anchor = previous.current;
    const row = anchor && rows.find((row) => row.turn.id === anchor.id);
    const layout = JSON.stringify(rows.map((row) => [row.turn.id, row.height]));
    // Viewport/focus updates must never pull a user's scroll back to an old anchor.
    if (layout !== previousLayout.current) {
      previousLayout.current = layout;
      if (stick) root.scrollTop = root.scrollHeight;
      else if (row && anchor) {
        const offset = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
        root.scrollTop = offset + row.top + anchor.offset;
      }
    }
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.virtualTurn!;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (height > 0 && (heights.current.get(id)?.height !== height || heights.current.get(id)?.folded !== live.current.folded.has(id))) {
          heights.current.set(id, { folded: live.current.folded.has(id), height });
          changed = true;
        }
      }
      if (changed) remeasure((version) => version + 1);
    });
    for (const element of Array.from(list.children)) observer.observe(element);
    return () => observer.disconnect();
  });

  return <div ref={container} className="virtual-turns" style={{ position: "relative", height: total, flexShrink: 0, overflowAnchor: "none" }}>
    {rows.filter((row) => row.top + row.height >= viewport.top - OVERSCAN && row.top <= viewport.top + viewport.height + OVERSCAN
      || pinned.has(row.turn.id)).map((row) => <div key={row.turn.id} data-virtual-turn={row.turn.id}
        style={{ position: "absolute", top: row.top, width: "100%", display: "flow-root" }}>
        {children(row.turn)}
      </div>)}
  </div>;
}
