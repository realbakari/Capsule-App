import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { latestAgentFile, type Run, type RunEvent } from "@capsule/shared";

const LIVE = new Set<Run["status"]>(["queued", "running", "waiting", "approval_required"]);

export type FollowStatus = "off" | "idle" | "following" | "paused";

/**
 * Files following the agent: while a turn runs, each new file the agent reads
 * or edits is handed to `onFollow`. Navigating by hand pauses it for the rest
 * of that turn; the next turn follows again.
 */
export function useFollowAgent({ enabled, visible, run, events, onFollow }: {
  enabled: boolean;
  /** Files is the surface on screen. Following never switches surfaces. */
  visible: boolean;
  run?: Run;
  events: readonly RunEvent[];
  onFollow: (path: string) => void;
}) {
  const live = run && LIVE.has(run.status) ? run : undefined;
  const [pausedRun, setPausedRun] = useState<string>();
  const file = useMemo(() => live ? latestAgentFile(events, live.id) : undefined, [events, live]);
  const paused = Boolean(live && pausedRun === live.id);
  const follow = useRef(onFollow);
  follow.current = onFollow;
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !visible || paused || !file || shown.current === file.eventId) return;
    shown.current = file.eventId;
    follow.current(file.path);
  }, [enabled, visible, paused, file]);
  const status: FollowStatus = !enabled ? "off" : !live ? "idle" : paused ? "paused" : "following";
  const current = useRef({ enabled, liveId: live?.id });
  current.current = { enabled, liveId: live?.id };
  // Stable, so memoized file-tree handlers that pause do not re-render the tree.
  const pause = useCallback(() => {
    const { enabled: on, liveId } = current.current;
    if (on && liveId) setPausedRun(liveId);
  }, []);
  const resume = useCallback(() => setPausedRun(undefined), []);
  return { status, path: status === "following" ? file?.path : undefined, pause, resume };
}
