import { useCallback, useEffect, useState } from "react";
import type { RatingValue } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { ThumbsDownIcon, ThumbsUpIcon } from "../shell/icons";
import "./best-of-n.css";

/*
 * Thumbs on a final reply. The rating stays on this computer and feeds the
 * "Your results" leaderboard by agent and model. Pressing the same thumb
 * again takes the rating back. A paired device sees the rating but cannot
 * change it.
 */
export function RatingButtons({ value, onRate, writable, label = "this reply" }: { value?: RatingValue; onRate: (value: RatingValue | 0) => void; writable: boolean; label?: string }) {
  if (!writable && !value) return null;
  return (
    <span className="rating-buttons" role="group" aria-label={`Rate ${label}`}>
      <button type="button" className={`icon-btn${value === 1 ? " active" : ""}`} aria-pressed={value === 1} disabled={!writable}
        title={value === 1 ? "Rated good. Press again to clear" : "Good result"} aria-label="Good result" onClick={() => onRate(value === 1 ? 0 : 1)}>
        <ThumbsUpIcon size={13} />
      </button>
      <button type="button" className={`icon-btn${value === -1 ? " active" : ""}`} aria-pressed={value === -1} disabled={!writable}
        title={value === -1 ? "Rated poor. Press again to clear" : "Poor result"} aria-label="Poor result" onClick={() => onRate(value === -1 ? 0 : -1)}>
        <ThumbsDownIcon size={13} />
      </button>
    </span>
  );
}

/** A thread's ratings, read once per thread and updated as they change here. */
export function useRunRatings(sessionId: string | undefined) {
  const { api, setNotice } = useWorkspace();
  const [ratings, setRatings] = useState<{ sessionId: string; values: Record<string, RatingValue> }>();
  useEffect(() => {
    if (!sessionId) return undefined;
    let current = true;
    void api.runRatings?.(sessionId).then((values) => { if (current) setRatings({ sessionId, values }); }, () => undefined);
    return () => { current = false; };
  }, [api, sessionId]);
  const rate = useCallback((runId: string, value: RatingValue | 0) => {
    if (!sessionId) return;
    setRatings((current) => {
      const values = { ...(current?.sessionId === sessionId ? current.values : {}) };
      if (value === 0) delete values[runId];
      else values[runId] = value;
      return { sessionId, values };
    });
    void api.rateRun(runId, value).catch((error) => setNotice(`Could not save the rating: ${formatUserError(error)}`));
  }, [api, sessionId, setNotice]);
  return { ratings: ratings && ratings.sessionId === sessionId ? ratings.values : {}, rate, writable: api.isDesktop !== false };
}
