import type { ChatMessage, Run } from "@capsule/shared";

export const MAX_RETAINED_MESSAGES = 300;
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
export const MAX_MESSAGE_CHARACTERS = 64 * 1024;

/** A display budget, not deletion: full messages remain in the local database. */
export function boundTranscript(messages: ChatMessage[], edge: "oldest" | "newest") {
  const ordered = edge === "newest" ? [...messages].reverse() : messages;
  const retained: ChatMessage[] = [];
  let bytes = 0;
  for (const message of ordered) {
    const content = message.content.slice(0, MAX_MESSAGE_CHARACTERS);
    // Timeline rows use file labels, not composer thumbnails. Do not retain
    // large data URIs from an optimistic image-only submission here.
    const attachments = message.attachments?.some((item) => item.thumbnail)
      ? message.attachments.map(({ thumbnail: _thumbnail, ...attachment }) => attachment)
      : message.attachments;
    // Include attachment metadata in the budget; binary attachments live outside history.
    const size = content.length * 2 + JSON.stringify(attachments ?? []).length * 2 + 512;
    if (retained.length >= MAX_RETAINED_MESSAGES || bytes + size > MAX_TRANSCRIPT_BYTES) break;
    retained.push(content === message.content && attachments === message.attachments ? message
      : { ...message, content, attachments, contentTruncated: message.contentTruncated || content !== message.content });
    bytes += size;
  }
  if (edge === "newest") retained.reverse();
  return { messages: retained, trimmed: retained.length < messages.length, bytes };
}

/** Keep receipts with the displayed time range, plus a bounded live tail. */
export function retainRunReceipts(runs: Run[], messages: ChatMessage[]): Run[] {
  const ids = new Set(messages.flatMap((message) => message.runId ? [message.runId] : []));
  const first = messages[0]?.createdAt;
  const last = messages.at(-1)?.createdAt;
  return runs.filter((run, index) => index < 100 || ids.has(run.id)
    || (first && last && run.createdAt >= first && run.createdAt <= last)).slice(0, 700);
}
