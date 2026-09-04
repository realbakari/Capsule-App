import type { ChatMessage } from "./types.js";

/**
 * Has this reply already been recorded for the turn in progress?
 *
 * A reply reaches Capsule more than once. It streams in as text, and it can
 * arrive again as a snapshot of what the agent said, over either the Gateway
 * route or Direct mode — both of which deliver into the same handler. Only one
 * of them should become a message in the thread.
 *
 * The check this replaces asked whether the identical message happened to be
 * the newest one in the session. That is a question about position, not about
 * the reply: anything landing in between made an already-recorded answer look
 * new, and the thread showed it twice. In the database those pairs are exact —
 * byte-identical content, one copy carrying the run that produced it and one
 * carrying nothing.
 *
 * The turn is the right scope. Within one turn an identical answer is the same
 * answer arriving twice; across turns it is a fresh reply that happens to read
 * the same, which a person can genuinely produce by asking the same thing
 * again, and which must still appear.
 */
export function isReplyAlreadyRecorded(
  messages: readonly ChatMessage[],
  content: string,
  activeRunId?: string,
): boolean {
  /*
   * With a run in hand the answer is exact: the same text already attributed
   * to the same turn.
   */
  if (activeRunId !== undefined) {
    return messages.some(
      (item) => item.role === "assistant" && item.runId === activeRunId && item.content === content,
    );
  }

  /*
   * Without one — the run has already settled by the time the copy arrives —
   * the turn is bounded by the last thing the person said. An identical reply
   * after that point belongs to the exchange in progress.
   */
  let lastUserAt = -Infinity;
  for (const item of messages) {
    if (item.role !== "user") continue;
    const at = Date.parse(item.createdAt);
    if (Number.isFinite(at) && at > lastUserAt) lastUserAt = at;
  }

  return messages.some((item) => {
    if (item.role !== "assistant" || item.content !== content) return false;
    // An unparseable timestamp should not license a second copy.
    const at = Date.parse(item.createdAt);
    return !Number.isFinite(at) || at >= lastUserAt;
  });
}
