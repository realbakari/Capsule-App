/**
 * A worktree thread set aside: its work saved to a hidden ref, the processes
 * it started stopped. Resume puts the work back and clears this.
 */
export interface ThreadPause {
  pausedAt: string;
  /** Hidden ref holding the folder and staging area as they stood. */
  ref: string;
  /** The branch tip when it paused. */
  head: string | null;
  /** Project actions (dev servers, previews) that were running and were stopped. */
  stoppedActions: string[];
}
