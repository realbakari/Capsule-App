import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Turn } from "../../lib/turns";
import { localTimings } from "@capsule/shared";
import { recallTurnAnchor, rememberTurnAnchor, type TurnAnchor } from "../../lib/turn-anchors";

const OVERSCAN = 700;
/** Where a turn lands below the top of the view: a jump to it, or a prompt just sent. */
const TURN_TOP = 48;
/** A control that opens or closes part of the transcript in place. A menu button opens a popover instead. */
const DISCLOSURE = "[aria-expanded]:not([aria-haspopup]), summary";

/** Only a view actually scrolled up from the latest turn is a place worth coming back to. */
function awayFromLatest(root: HTMLElement, following: boolean): boolean {
  return !following && root.scrollHeight - root.scrollTop - root.clientHeight > 48;
}

function answered(turn: Turn | undefined): boolean {
  return Boolean(turn?.messages.some((message) => message.role === "assistant"));
}

/**
 * Variable-height rows. Measurements and focus belong to stable turn IDs.
 * The first and last turns stay mounted, so heading navigation reaches both
 * ends of the thread.
 */
export function VirtualTurns({ turns, folded, scroller, stick, following: followingNow, running = false, endSpace, focus, restoreKey, onRestore, onDisclosure, children }: {
  turns: Turn[];
  folded: ReadonlySet<string>;
  scroller: RefObject<HTMLDivElement | null>;
  stick: boolean;
  /** The parent's follow decision as of the latest scroll, which can be ahead of `stick` until the next render. */
  following?: RefObject<boolean>;
  /** A turn is running in this thread. */
  running?: boolean;
  /**
   * An empty block after everything else in the transcript. While a turn sent
   * at the live end runs, it is sized so the end of the scroll puts that
   * turn's prompt near the top and the reply streams in below it.
   */
  endSpace?: RefObject<HTMLDivElement | null>;
  /** Told when a disclosure is toggled, so the parent stops following the latest. */
  onDisclosure?: () => void;
  /**
   * A turn to scroll to and mark; the nonce lets the same turn be asked for
   * twice. Find keeps its mark; a jump flashes it briefly.
   */
  focus?: { id: string; nonce: number; flash?: boolean };
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
  /*
   * A jump holds its turn as the anchor until the reader scrolls. It aims at
   * the turn in the same pass that unfolds it: keeping the old view still
   * first would move the scroll down, which reads as a return to the latest.
   * The rows it mounts are measured mid-scroll, so each pass re-aims.
   */
  const landing = useRef<TurnAnchor | undefined>(undefined);
  const landed = useRef<typeof focus>(undefined);
  /* The disclosure last toggled stays where it was clicked until the reader scrolls. */
  const held = useRef<{ element: Element; top: number } | undefined>(undefined);
  /* The newest turn, and the one sent at the live end whose prompt sits near the top while it runs. */
  const lastTurn = useRef(turns.at(-1)?.id);
  const sent = useRef<{ id: string; ran: boolean } | undefined>(undefined);
  const previousLayout = useRef("");
  let total = 0;
  const rows = turns.map((turn) => {
    const measurement = heights.current.get(turn.id);
    const height = measurement?.folded === folded.has(turn.id) ? measurement.height : folded.has(turn.id) ? 68 : 320;
    const row = { turn, top: total, height };
    total += height;
    return row;
  });
  const live = useRef({ rows, folded, stick, followingNow, restoreKey, endSpace, onDisclosure });
  live.current = { rows, folded, stick, followingNow, restoreKey, endSpace, onDisclosure };
  /** Sizes the end space for the sent turn; true when its height changed. */
  const fitEnd = (root: HTMLElement): boolean => {
    const space = live.current.endSpace?.current;
    if (!space) return false;
    const id = sent.current?.id;
    const row = id ? container.current?.querySelector<HTMLElement>(`[data-virtual-turn="${CSS.escape(id)}"]`) : null;
    const current = space.offsetHeight;
    let height = 0;
    if (row) {
      const rowTop = row.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      height = Math.max(0, Math.round(root.clientHeight - TURN_TOP - (root.scrollHeight - current - rowTop)));
    }
    if (height === current) return false;
    space.style.height = `${height}px`;
    return true;
  };
  /** Keeps a toggled disclosure where it was clicked; false when none is held. */
  const keepHeld = (root: HTMLElement): boolean => {
    const hold = held.current;
    if (!hold?.element.isConnected) { held.current = undefined; return false; }
    const moved = hold.element.getBoundingClientRect().top - root.getBoundingClientRect().top - hold.top;
    if (Math.abs(moved) >= 1) root.scrollTop += moved;
    return true;
  };
  const announceRestore = useRef(onRestore);
  useEffect(() => {
    if (restoring.current) announceRestore.current?.();
    // Leaving the thread records where it was left, following or not.
    return () => {
      const { restoreKey: key, stick: following } = live.current;
      const root = scroller.current;
      if (key && !restoring.current) rememberTurnAnchor(key, root && awayFromLatest(root, following) ? previous.current : undefined);
    };
  }, []);
  useEffect(() => {
    if (focus) setPinned((current) => new Set(current).add(focus.id));
  }, [focus]);

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
      if (live.current.restoreKey && !restoring.current) rememberTurnAnchor(live.current.restoreKey, awayFromLatest(root, live.current.stick) ? previous.current : undefined);
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
    const release = () => { landing.current = undefined; held.current = undefined; };
    // Capture runs before the disclosure's own click handler re-renders it.
    const hold = (event: MouseEvent) => {
      const control = event.target instanceof Element ? event.target.closest(DISCLOSURE) : null;
      if (!control || !root.contains(control)) return;
      held.current = { element: control, top: control.getBoundingClientRect().top - root.getBoundingClientRect().top };
      live.current.onDisclosure?.();
    };
    // Content after the turns (the live run's summary, a request card) changes the end too.
    const thread = list.parentElement;
    const threadObserver = new ResizeObserver(() => {
      fitEnd(root);
      if (keepHeld(root)) return;
      if ((live.current.followingNow?.current ?? live.current.stick) && !restoring.current) root.scrollTop = root.scrollHeight;
    });
    if (thread) threadObserver.observe(thread);
    root.addEventListener("click", hold, true);
    const input = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of input) window.addEventListener(type, release, { capture: true, passive: true });
    const observer = new ResizeObserver(() => { fitEnd(root); schedule(); });
    observer.observe(root);
    root.addEventListener("scroll", readViewport, { passive: true });
    document.addEventListener("selectionchange", preserveInteraction);
    document.addEventListener("focusin", preserveInteraction);
    readViewport();
    return () => {
      cancelAnimationFrame(frame);
      for (const type of input) window.removeEventListener(type, release, { capture: true });
      observer.disconnect();
      threadObserver.disconnect();
      root.removeEventListener("click", hold, true);
      const space = live.current.endSpace?.current;
      if (space) space.style.height = "";
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
    const last = turns.at(-1);
    if (last?.id !== lastTurn.current) {
      // A turn added at the end while following, still waiting on its reply, is one just sent.
      sent.current = last && lastTurn.current !== undefined && stick && (running || !answered(last)) ? { id: last.id, ran: false } : undefined;
      lastTurn.current = last?.id;
    }
    // Its space goes once it has finished, so a settled thread never ends in a gap.
    if (sent.current && running) sent.current.ran = true;
    else if (sent.current && (sent.current.ran || answered(last))) sent.current = undefined;
    const resized = fitEnd(root);
    const aim = Boolean(focus && focus !== landed.current);
    if (aim) {
      landed.current = focus;
      landing.current = { id: focus!.id, offset: -TURN_TOP };
    }
    const anchor = restoring.current ?? landing.current ?? previous.current;
    const following = stick && !restoring.current;
    const row = anchor && rows.find((row) => row.turn.id === anchor.id);
    const layout = JSON.stringify(rows.map((row) => [row.turn.id, row.height]));
    // Viewport/focus updates must never pull a user's scroll back to an old anchor.
    if (layout !== previousLayout.current || aim || resized) {
      previousLayout.current = layout;
      // A toggled disclosure outranks following and the reading anchor; only a jump moves past it.
      if (aim || !keepHeld(root)) {
        if (following) root.scrollTop = root.scrollHeight;
        else if (row && anchor) {
          const offset = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
          if (anchor === landing.current) root.scrollTo({ top: Math.max(0, offset + row.top + anchor.offset), behavior: "smooth" });
          else root.scrollTop = offset + row.top + anchor.offset;
        }
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
      if (!changed) return;
      // Before paint, so the toggled control never flickers away while rows re-place.
      if (scroller.current) keepHeld(scroller.current);
      remeasure((version) => version + 1);
    });
    for (const element of Array.from(list.children)) observer.observe(element);
    return () => observer.disconnect();
  });

  return <div ref={container} className="virtual-turns" style={{ position: "relative", height: total, flexShrink: 0, overflowAnchor: "none" }}>
    {rows.filter((row, index) => index === 0 || index === rows.length - 1
      || row.top + row.height >= viewport.top - OVERSCAN && row.top <= viewport.top + viewport.height + OVERSCAN
      || pinned.has(row.turn.id)).map((row) => <div key={row.turn.id} data-virtual-turn={row.turn.id} className={focus?.id === row.turn.id ? focus.flash ? "turn-flash" : "turn-focus" : undefined}
        style={{ position: "absolute", top: row.top, width: "100%", display: "flow-root" }}>
        {children(row.turn)}
      </div>)}
  </div>;
}
