/**
 * Where each thread was being read, as the turn at the top of the view and
 * how far into it. A turn id survives heights changing and older pages
 * loading, where a pixel offset would not.
 *
 * Module memory, bounded: this is where you were a moment ago, not a
 * preference. A thread followed to its latest turn has no entry, so it opens
 * at the bottom as before.
 */
export interface TurnAnchor { id: string; offset: number }

const LIMIT = 64;
const anchors = new Map<string, TurnAnchor>();

export function rememberTurnAnchor(key: string, anchor: TurnAnchor | undefined): void {
  anchors.delete(key);
  if (!anchor) return;
  anchors.set(key, anchor);
  if (anchors.size > LIMIT) anchors.delete(anchors.keys().next().value!);
}

export function recallTurnAnchor(key: string): TurnAnchor | undefined {
  return anchors.get(key);
}

export function clearTurnAnchors(): void {
  anchors.clear();
}
