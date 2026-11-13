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
 * The empty composer teaches what its keys do in the state it is in: a new
 * thread says what to write, a thread in progress says how to send, and a
 * running turn says that Return queues rather than interrupts.
 */
export function composerPlaceholder(input: { running: boolean; hasMessages: boolean; sendOnEnter: boolean; agent?: string; steer?: boolean }): string {
  const send = input.sendOnEnter ? "↵" : "⌘↵";
  if (input.running) return input.steer ? `${send} to steer this turn` : `${send} to queue a follow-up for when this turn ends`;
  /* A new thread names what the composer understands: files, skills and commands. */
  if (!input.hasMessages) return "Ask anything. @ files, $ skills, / commands";
  const who = input.agent ? `Reply to ${input.agent}` : "Reply";
  return input.sendOnEnter ? `${who} · ↵ to send, ⇧↵ for a new line` : `${who} · ⌘↵ to send`;
}
