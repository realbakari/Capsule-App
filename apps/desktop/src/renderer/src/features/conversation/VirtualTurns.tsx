import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Turn } from "../../lib/turns";
import { localTimings } from "@capsule/shared";
import { recallTurnAnchor, rememberTurnAnchor, type TurnAnchor } from "../../lib/turn-anchors";

const OVERSCAN = 700;

/** Variable-height rows. Measurements and focus belong to stable turn IDs. */
export function VirtualTurns({ turns, folded, scroller, stick, focus, restoreKey, onRestore, children }: {
  turns: Turn[];
  folded: ReadonlySet<string>;
  scroller: RefObject<HTMLDivElement | null>;
  stick: boolean;
  /** A turn to scroll to and mark, for find; the nonce lets the same turn be asked for twice. */
  focus?: { id: string; nonce: number };
  /** Names the thread, so reading position comes back when you return to it. */
  restoreKey?: string;
  /** Told when a remembered position is restored, so the parent stops following. */
  onRestore?: () => void;
  children: (turn: Turn) => ReactNode;
}) {
  const renderStarted = performance.now();
  const container = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, { folded: boolean; height: number }>());
  const [viewport, setViewport] = useState({ top: 0, height: 900 });
  const [, remeasure] = useState(0);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  /* Read once on mount; held until the parent has stopped following. */
  const restoring = useRef<TurnAnchor | undefined>(restoreKey ? recallTurnAnchor(restoreKey) : undefined);
  const previous = useRef<{ id: string; offset: number } | undefined>(restoring.current);
  const previousLayout = useRef("");
  let total = 0;
  const rows = turns.map((turn) => {
    const measurement = heights.current.get(turn.id);
    const height = measurement?.folded === folded.has(turn.id) ? measurement.height : folded.has(turn.id) ? 68 : 320;
    const row = { turn, top: total, height };
    total += height;
    return row;
  });
  const live = useRef({ rows, folded, stick, restoreKey });
  live.current = { rows, folded, stick, restoreKey };
  const announceRestore = useRef(onRestore);
  useEffect(() => {
    if (restoring.current) announceRestore.current?.();
    // Leaving the thread records where it was left, following or not.
    return () => {
      const { restoreKey: key, stick: following } = live.current;
      if (key && !restoring.current) rememberTurnAnchor(key, following ? undefined : previous.current);
    };
  }, []);
  useEffect(() => {
    if (!focus) return;
    const root = scroller.current;
    const list = container.current;
    const row = live.current.rows.find((row) => row.turn.id === focus.id);
    if (!root || !list || !row) return;
    const offset = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({ top: Math.max(0, offset + row.top - 48), behavior: "smooth" });
    setPinned((current) => new Set(current).add(focus.id));
  }, [focus, scroller]);

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
      // Until the first rows arrive there is nothing to read the view from.
      if (restoring.current && live.current.rows.length === 0) return;
      previous.current = row ? { id: row.turn.id, offset: top - row.top } : undefined;
      if (live.current.restoreKey && !restoring.current) rememberTurnAnchor(live.current.restoreKey, live.current.stick ? undefined : previous.current);
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
    if (restoring.current && !stick && rows.some((row) => row.turn.id === restoring.current!.id) && previousLayout.current) restoring.current = undefined;
    const anchor = restoring.current ?? previous.current;
    const following = stick && !restoring.current;
    const row = anchor && rows.find((row) => row.turn.id === anchor.id);
    const layout = JSON.stringify(rows.map((row) => [row.turn.id, row.height]));
    // Viewport/focus updates must never pull a user's scroll back to an old anchor.
    if (layout !== previousLayout.current) {
      previousLayout.current = layout;
      if (following) root.scrollTop = root.scrollHeight;
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
      || pinned.has(row.turn.id)).map((row) => <div key={row.turn.id} data-virtual-turn={row.turn.id} className={focus?.id === row.turn.id ? "turn-focus" : undefined}
        style={{ position: "absolute", top: row.top, width: "100%", display: "flow-root" }}>
        {children(row.turn)}
      </div>)}
  </div>;
}
