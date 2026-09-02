/*
 * Sizing for the panels that share the window with the conversation.
 *
 * The inspector clamped itself between 340 and 1080 pixels and never asked
 * whether the conversation still fit. On a narrow window that let a drag —
 * or a saved width restored on a smaller screen — squeeze the transcript and
 * the composer down to nothing.
 */

export interface PanelSizeInput {
  /** The width the drag is asking for. */
  requested: number;
  /** The width right now, so a shrink is never refused. */
  current: number;
  /** Everything the panel and the content share. */
  available: number;
  min: number;
  max: number;
  /** What the conversation beside it needs to stay usable. */
  minContent: number;
}

export function clampPanelWidth(input: PanelSizeInput): number {
  const bounded = Math.round(Math.max(input.min, Math.min(input.max, input.requested)));
  /*
   * A shrink always goes through. Refusing one on a window that is already
   * too small is how a panel gets stuck at a width nobody can undo.
   */
  if (bounded <= input.current) return bounded;
  const room = Math.round(input.available - input.minContent);
  return Math.max(input.current, Math.min(bounded, room));
}

/**
 * The width a panel should take after the window changed size. Gives the
 * content back its minimum, but never shrinks the panel below its own.
 */
export function fitPanelWidth(input: {
  current: number;
  available: number;
  min: number;
  minContent: number;
}): number {
  const room = Math.round(input.available - input.minContent);
  if (input.current <= room) return input.current;
  return Math.max(input.min, room);
}
