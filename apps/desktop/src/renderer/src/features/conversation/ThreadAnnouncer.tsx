import { useEffect, useRef } from "react";
import { nextThreadAnnouncement, type ThreadActivity, type ThreadAnnouncementMemory } from "../../lib/thread-announcement";

/* Long enough for a screen reader to finish one short sentence before the next replaces it. */
const QUIET_MS = 1500;

/**
 * The open thread's polite live region. It speaks changes, never streamed
 * text: a turn that finished, failed, or stopped, and a request that starts
 * waiting. Sentences that land close together are spoken as one write, since
 * a second write replaces the first before it is heard.
 */
export function ThreadAnnouncer({ activity }: { activity: ThreadActivity }) {
  const region = useRef<HTMLDivElement>(null);
  const memory = useRef<ThreadAnnouncementMemory | undefined>(undefined);
  const pace = useRef<{ waiting: string[]; quietUntil: number; timer?: number }>({ waiting: [], quietUntil: 0 });
  const requestKey = activity.requests.map((request) => request.id).join();
  useEffect(() => {
    const threadChanged = memory.current?.threadId !== activity.threadId;
    const next = nextThreadAnnouncement(memory.current, activity);
    memory.current = next.memory;
    const state = pace.current;
    const node = region.current;
    if (threadChanged) {
      window.clearTimeout(state.timer);
      state.waiting = [];
      if (node) node.textContent = "";
    }
    if (!next.text || !node) return;
    state.waiting.push(next.text);
    if (state.timer !== undefined) return;
    const speak = () => {
      state.timer = undefined;
      const text = state.waiting.join(" ");
      state.waiting = [];
      // The same sentence twice in a row is only heard if the region empties first.
      node.textContent = "";
      requestAnimationFrame(() => { node.textContent = text; });
      state.quietUntil = Date.now() + QUIET_MS;
    };
    state.timer = window.setTimeout(speak, Math.max(0, state.quietUntil - Date.now()));
    // activity is read through its parts so a new object each render is not a change.
  }, [activity.threadId, activity.run?.id, activity.run?.status, requestKey]);
  useEffect(() => () => window.clearTimeout(pace.current.timer), []);
  // No role="status": some screen readers treat it as a status bar and drop its updates.
  return <div ref={region} className="sr-only" aria-live="polite" aria-atomic="true" data-thread-announcer="" />;
}
