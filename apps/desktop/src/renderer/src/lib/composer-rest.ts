/**
 * When the reader leaves the live edge of the thread, the composer rests
 * (one-line prompt, chrome tucked away). It expands again at the latest
 * messages. Focus alone must not grow it back over the transcript. A
 * multiline draft, open picker, or attachments still need the full dock.
 */
export function shouldRestComposer(input: {
  awayFromLatest: boolean;
  blocking: boolean;
  multiline: boolean;
  hasAttachments?: boolean;
  hasSkill?: boolean;
}): boolean {
  if (input.blocking || input.multiline || input.hasAttachments || input.hasSkill) return false;
  return input.awayFromLatest;
}

/** Leave the live edge after a short scroll; do not rejoin just because rest changed layout height. */
export const LEAVE_LATEST_PX = 24;
export const JOIN_LATEST_PX = 80;

export function shouldFollowLatest(input: {
  following: boolean;
  distanceFromBottom: number;
  scrollDelta: number;
}): boolean {
  if (input.following) return input.distanceFromBottom < LEAVE_LATEST_PX;
  return input.scrollDelta > 1 && input.distanceFromBottom < JOIN_LATEST_PX;
}

/**
 * One idle line that names what the composer understands, first message or
 * not. While a turn runs it says what a message will do to that turn.
 */
export function composerPlaceholder(input: { running: boolean; steer?: boolean }): string {
  if (input.running) return input.steer ? "Steer this turn" : "Queue a follow-up";
  return "Ask anything. @ files, $ skills, / commands";
}

/** What a page key leaves for the transcript: the overlap kept on screen between pages. */
export const PAGE_OVERLAP_PX = 40;

/**
 * PageUp and PageDown typed in the composer page the transcript, unless the
 * draft is tall enough to scroll itself that way. A modifier or an IME
 * composition keeps the key for the field.
 */
export function composerPageDirection(input: {
  key: string;
  modified: boolean;
  composing: boolean;
  field: { scrollTop: number; scrollHeight: number; clientHeight: number };
}): -1 | 1 | 0 {
  if (input.key !== "PageUp" && input.key !== "PageDown") return 0;
  if (input.modified || input.composing) return 0;
  const { scrollTop, scrollHeight, clientHeight } = input.field;
  const fieldScrolls = input.key === "PageUp" ? scrollTop > 1 : scrollTop < scrollHeight - clientHeight - 1;
  if (fieldScrolls) return 0;
  return input.key === "PageUp" ? -1 : 1;
}

const GLIDE_MS = 150;

/**
 * Scrolls by `distance` over a short ease-out, returning a cancel. A native
 * smooth scroll cannot be stopped from script, so a jump to the end made while
 * a page was still gliding up would be carried away from the end again.
 */
export function glideScroll(node: { scrollTop: number }, distance: number, reduceMotion: boolean): () => void {
  const from = node.scrollTop;
  if (reduceMotion) { node.scrollTop = from + distance; return () => {}; }
  const started = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const progress = Math.min(1, (now - started) / GLIDE_MS);
    node.scrollTop = from + distance * (1 - (1 - progress) ** 3);
    frame = progress < 1 ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
