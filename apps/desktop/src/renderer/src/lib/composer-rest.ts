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
