import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ChatMessage } from "@capsule/shared";
import type { Turn } from "../../lib/turns";
import { useWorkspace } from "../../lib/workspace";
import { SearchIcon, XIcon } from "../shell/icons";
import { alignSegments, collectTextSegments, findInTurns, matchBounds, messageSegments, type FindMatch } from "./thread-find";

const ALL = "capsule-find";
const CURRENT = "capsule-find-current";
/* The DOM lib this app builds with leaves out the registry's map methods. */
interface HighlightRegistry { set(name: string, highlight: Highlight): unknown; delete(name: string): unknown }
function highlightRegistry(): HighlightRegistry | undefined {
  return typeof Highlight === "undefined" ? undefined : (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
}
/** How long a step keeps trying to bring its match into view while the turn mounts and settles. */
const SETTLE_MS = 1500;

/** The first match at or below the top of the view, so typing does not jump to the start of a long thread. */
function nearestMatch(matches: readonly FindMatch[], turns: readonly Turn[], scroller: HTMLElement | null): number {
  if (!scroller || matches.length === 0) return 0;
  const top = scroller.getBoundingClientRect().top;
  const visible = Array.from(scroller.querySelectorAll<HTMLElement>("[data-virtual-turn]"))
    .find((row) => row.getBoundingClientRect().bottom > top)?.dataset.virtualTurn;
  const order = new Map(turns.map((turn, index) => [turn.id, index]));
  const from = visible ? order.get(visible) ?? 0 : 0;
  const index = matches.findIndex((match) => (order.get(match.turnId) ?? 0) >= from);
  return index < 0 ? 0 : index;
}

/**
 * Paint every mounted match, the current one apart, with the CSS Custom
 * Highlight API: the transcript's DOM is never rewritten, so a streamed
 * frame, a selection or a copy is untouched by find. Returns the current
 * match's range when it is mounted.
 */
function paint(registry: HighlightRegistry, scroller: HTMLElement, matches: readonly FindMatch[], current: FindMatch | undefined, messages: ReadonlyMap<string, ChatMessage>): Range | undefined {
  const byMessage = new Map<string, FindMatch[]>();
  for (const match of matches) byMessage.set(match.messageId, [...(byMessage.get(match.messageId) ?? []), match]);
  const others: Range[] = [];
  let active: Range | undefined;
  for (const row of Array.from(scroller.querySelectorAll<HTMLElement>("[data-message-id]"))) {
    const id = row.dataset.messageId!;
    const found = byMessage.get(id);
    const message = messages.get(id);
    const body = row.querySelector(".body");
    if (!found || !message || !body) continue;
    const blocks = alignSegments(messageSegments(message), collectTextSegments(body));
    for (const match of found) {
      const block = blocks[match.segment];
      const bounds = block && matchBounds(block, match.start, match.end);
      if (!bounds) continue;
      const range = document.createRange();
      range.setStart(bounds.startNode as Node, bounds.startOffset);
      range.setEnd(bounds.endNode as Node, bounds.endOffset);
      if (match === current) active = range;
      else others.push(range);
    }
  }
  registry.set(ALL, new Highlight(...others));
  registry.set(CURRENT, active ? new Highlight(active) : new Highlight());
  return active;
}

/** A fold hiding the range: a folded long prompt, or a turn's work while closed. */
function hidingFold(range: Range): Element | undefined {
  const start = range.startContainer.parentElement;
  if (start?.closest("[hidden]")) return start.closest("[hidden]")!;
  const fold = start?.closest("[data-thread-find-fold]");
  return fold && range.getBoundingClientRect().bottom > fold.getBoundingClientRect().bottom ? fold : undefined;
}

function useFindHighlights(scroller: RefObject<HTMLDivElement | null>, matches: readonly FindMatch[], current: FindMatch | undefined, step: number, messages: ReadonlyMap<string, ChatMessage>) {
  const live = useRef({ matches, current, messages });
  live.current = { matches, current, messages };
  /* Each step scrolls its match into view once it is laid out, then leaves the reader's scrolling alone. */
  const pending = useRef<{ until: number } | undefined>(undefined);
  const schedule = useRef(() => {});
  useEffect(() => {
    const root = scroller.current;
    const registry = highlightRegistry();
    if (!root || !registry) return;
    let frame = 0;
    const repaint = () => {
      frame = 0;
      const range = paint(registry, root, live.current.matches, live.current.current, live.current.messages);
      const wanted = pending.current;
      if (!range || !wanted) return;
      if (performance.now() > wanted.until) { pending.current = undefined; return; }
      const fold = hidingFold(range);
      if (fold) { fold.dispatchEvent(new Event("beforematch")); return; }
      const box = root.getBoundingClientRect();
      const rect = range.getBoundingClientRect();
      if (rect.top >= box.top + 24 && rect.bottom <= box.bottom - 24) { pending.current = undefined; return; }
      root.scrollTo({ top: root.scrollTop + rect.top - box.top - root.clientHeight / 3 });
    };
    schedule.current = () => { if (!frame) frame = requestAnimationFrame(repaint); };
    // Rows mount as the view moves and replies stream in; paint what is there now.
    const observer = new MutationObserver(() => schedule.current());
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "data-thread-find-fold"] });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      schedule.current = () => {};
      registry.delete(ALL);
      registry.delete(CURRENT);
    };
  }, [scroller]);
  useEffect(() => { pending.current = { until: performance.now() + SETTLE_MS }; }, [step]);
  useEffect(() => { schedule.current(); }, [matches, current, step]);
}

/**
 * ⌘F for the conversation. It searches the text replies show (not their
 * Markdown), counts every occurrence, highlights each one with the current
 * one apart, and brings the current one into view, opening a folded turn,
 * a turn's folded work or a long prompt to do it. It searches the messages
 * loaded so far, and says so while older pages are not loaded.
 */
export function ThreadFind({ initialQuery = "", turns, scroller, onReveal, onClose }: {
  /** The words a search hit matched, so the thread opens on them. */
  initialQuery?: string;
  turns: readonly Turn[];
  scroller: RefObject<HTMLDivElement | null>;
  /** Make the selected match's message mounted and visible: unfold its turn and work. */
  onReveal: (match: FindMatch | undefined) => void;
  onClose: () => void;
}) {
  const { hasOlderMessages, loadingOlder, loadOlderMessages } = useWorkspace();
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findInTurns(turns, query), [turns, query]);
  const messages = useMemo(() => new Map(turns.flatMap((turn) => turn.messages.map((message) => [message.id, message] as const))), [turns]);
  useEffect(() => { input.current?.focus(); }, []);
  const position = Math.min(index, Math.max(0, matches.length - 1));
  const current = matches[position];
  /*
   * A streamed frame rebuilds the matches. Reveal (which may scroll) only when
   * the selection moves to another match, never because a reply grew.
   */
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  const key = current && `${current.messageId}:${current.segment}:${current.start}`;
  useEffect(() => { reveal.current(current); }, [key, step]);
  useEffect(() => () => reveal.current(undefined), []);
  useFindHighlights(scroller, matches, current, step, messages);
  const select = (next: number) => { setIndex(next); setStep((value) => value + 1); };
  const move = (delta: number) => {
    if (matches.length) select((position + delta + matches.length) % matches.length);
  };
  return (
    <div className="thread-find" role="search" aria-label="Find in conversation">
      <SearchIcon size={13} />
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          select(nearestMatch(findInTurns(turns, next), turns, scroller.current));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      />
      <span className="thread-find-count" aria-live="polite">{query.trim() ? (matches.length ? `${position + 1} of ${matches.length}` : "No matches") : ""}</span>
      {hasOlderMessages && <>
        <span className="thread-find-count">Searching loaded messages</span>
        <button type="button" className="chip" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? "Loading…" : "Load older"}</button>
      </>}
      <button type="button" className="chip" disabled={matches.length === 0} onClick={() => move(-1)} aria-label="Previous match" title="Previous match (⇧Enter)">Previous</button>
      <button type="button" className="chip" disabled={matches.length === 0} onClick={() => move(1)} aria-label="Next match" title="Next match (Enter)">Next</button>
      <button type="button" className="icon-btn" aria-label="Close find" onClick={onClose}><XIcon size={12} /></button>
    </div>
  );
}
