import { FOLLOW_UP_LIMIT, enqueuePrompt, moveQueued, removeQueued, type QueuedPrompt } from "@capsule/shared";

/**
 * Follow-ups typed while a turn is running. The engine keeps and sends them
 * now; these helpers remain for the composer's own list and for moving a
 * queue an older build left in this window's storage over to the engine.
 */

export { enqueuePrompt, moveQueued, removeQueued, type QueuedPrompt };

const KEY_PREFIX = "capsule.queue:";
const LIMIT = FOLLOW_UP_LIMIT;

export function queueKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

export function loadQueue(storage: Pick<Storage, "getItem">, sessionId: string): QueuedPrompt[] {
  try {
    const raw = storage.getItem(queueKey(sessionId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedPrompt).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function saveQueue(storage: Pick<Storage, "setItem" | "removeItem">, sessionId: string, queue: QueuedPrompt[]): boolean {
  try {
    if (queue.length === 0) storage.removeItem(queueKey(sessionId));
    else storage.setItem(queueKey(sessionId), JSON.stringify(queue.slice(0, LIMIT)));
    return true;
  } catch {
    return false;
  }
}

function isQueuedPrompt(value: unknown): value is QueuedPrompt {
  const item = value as Partial<QueuedPrompt> | null;
  return Boolean(item && typeof item.id === "string" && typeof item.content === "string" && Array.isArray(item.attachments) && typeof item.createdAt === "string");
}




/** The first item leaves the queue; the caller sends it. */
export function takeNext(queue: QueuedPrompt[]): { queue: QueuedPrompt[]; next?: QueuedPrompt } {
  const [next, ...rest] = queue;
  return next ? { queue: rest, next } : { queue };
}

/** Earlier prompts a person may want back, newest first, without immediate repeats. */
export function recallablePrompts(messages: ReadonlyArray<{ role: string; kind?: string; content: string }>): string[] {
  const out: string[] = [];
  for (const message of [...messages].reverse()) {
    if (message.role !== "user" || message.kind === "steer") continue;
    const text = message.content.trim();
    if (!text || out.at(-1) === text) continue;
    out.push(text);
    if (out.length >= 50) break;
  }
  return out;
}
