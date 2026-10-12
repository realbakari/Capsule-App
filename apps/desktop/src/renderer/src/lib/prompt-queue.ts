import type { MessageAttachment } from "@capsule/shared";

/**
 * Follow-ups typed while a turn is running. Instead of refusing the send,
 * the composer keeps them in order and sends each one when the thread is
 * free again. The queue belongs to a conversation and survives a restart.
 */

export interface QueuedPrompt {
  id: string;
  content: string;
  attachments: MessageAttachment[];
  skillId?: string;
  createdAt: string;
}

const KEY_PREFIX = "capsule.queue:";
const LIMIT = 20;

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

export function enqueuePrompt(queue: QueuedPrompt[], prompt: Omit<QueuedPrompt, "id" | "createdAt">, now = new Date()): { queue: QueuedPrompt[]; accepted: boolean } {
  if (queue.length >= LIMIT) return { queue, accepted: false };
  const id = `queued-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  return { queue: [...queue, { ...prompt, id, createdAt: now.toISOString() }], accepted: true };
}

export function removeQueued(queue: QueuedPrompt[], id: string): QueuedPrompt[] {
  return queue.filter((item) => item.id !== id);
}

export function moveQueued(queue: QueuedPrompt[], id: string, direction: "up" | "down"): QueuedPrompt[] {
  const index = queue.findIndex((item) => item.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= queue.length) return queue;
  const next = [...queue];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
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
