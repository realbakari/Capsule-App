export const SWIPE_EDGE_PX = 56;
export const SWIPE_THRESHOLD_PX = 72;
export const SWIPE_IDLE_MS = 180;

/** Horizontal trackpad delta, or 0 when the gesture is vertical. */
export function dominantHorizontalDelta(deltaX: number, deltaY: number): number {
  if (!Number.isFinite(deltaX) || Math.abs(deltaX) < 6) return 0;
  if (Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return 0;
  return deltaX;
}

export type SwipeCommit = "hide" | "show" | null;

/**
 * macOS wheel: two-finger swipe left (sidebar off-stage) is positive deltaX.
 * Swipe right (bring it back) is negative.
 */
export function reduceSwipe(input: {
  accumulated: number;
  deltaX: number;
  collapsed: boolean;
  threshold?: number;
}): { accumulated: number; commit: SwipeCommit } {
  const next = input.accumulated + input.deltaX;
  const threshold = input.threshold ?? SWIPE_THRESHOLD_PX;
  if (!input.collapsed && next >= threshold) return { accumulated: 0, commit: "hide" };
  if (input.collapsed && next <= -threshold) return { accumulated: 0, commit: "show" };
  return { accumulated: next, commit: null };
}

export function swipeTargetAllows(
  event: { clientX: number; target: EventTarget | null },
  collapsed: boolean,
): boolean {
  if (collapsed) return event.clientX <= SWIPE_EDGE_PX * 1.5;
  const node = event.target as { closest?: (selector: string) => unknown } | null;
  if (node?.closest?.(".sidebar, .sidebar-toggle, [data-sidebar-control]")) return true;
  return event.clientX <= SWIPE_EDGE_PX;
}
