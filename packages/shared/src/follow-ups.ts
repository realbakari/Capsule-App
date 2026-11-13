import type { MessageAttachment } from "./types.js";

/**
 * Follow-ups belong to a conversation, not to whatever the window shows.
 *
 * A prompt sent while a turn runs waits in its conversation's queue, and a
 * turn stopped by a usage limit can be scheduled to go again when the limit
 * lifts. The engine keeps both and sends them when the conversation is free,
 * so they go out in a thread nobody is looking at, or with the window closed.
 */

export interface QueuedPrompt {
  id: string;
  content: string;
  attachments: MessageAttachment[];
  skillId?: string;
  createdAt: string;
}

export interface ScheduledResume {
  /** The run that stopped on the limit, so the same stop is not scheduled twice. */
  runId: string;
  prompt: string;
  /** The stopped turn's files, so the resumed prompt is the same turn again. */
  attachments?: MessageAttachment[];
  /** Epoch milliseconds. */
  at: number;
}

export interface FollowUps {
  queue: QueuedPrompt[];
  resume?: ScheduledResume;
  /** Why the next queued prompt could not be sent; it stays first in line and is retried. */
  blocked?: string;
}

export type FollowUpPrompt = Pick<QueuedPrompt, "content" | "attachments" | "skillId">;

export type FollowUpOp =
  | { type: "add"; prompt: FollowUpPrompt }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; direction: "up" | "down" }
  | { type: "schedule"; resume: ScheduledResume }
  | { type: "cancel-resume" };

export const FOLLOW_UP_LIMIT = 20;
export const EMPTY_FOLLOW_UPS: FollowUps = { queue: [] };

export function enqueuePrompt(queue: QueuedPrompt[], prompt: FollowUpPrompt, now = new Date()): { queue: QueuedPrompt[]; accepted: boolean } {
  if (queue.length >= FOLLOW_UP_LIMIT) return { queue, accepted: false };
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

/** Apply one change. Throws with a message a person can act on when it cannot apply. */
export function applyFollowUpOp(state: FollowUps, op: FollowUpOp, now = new Date()): FollowUps {
  switch (op.type) {
    case "add": {
      const result = enqueuePrompt(state.queue, op.prompt, now);
      if (!result.accepted) throw new Error("The follow-up queue is full. Wait for the running turn or remove a queued message.");
      return { ...state, queue: result.queue };
    }
    case "remove": {
      const queue = removeQueued(state.queue, op.id);
      // Removing the prompt that was stuck clears the reason it was stuck.
      return { ...state, queue, ...(state.queue[0]?.id === op.id ? { blocked: undefined } : {}) };
    }
    case "move":
      return { ...state, queue: moveQueued(state.queue, op.id, op.direction) };
    case "schedule":
      return { ...state, resume: op.resume };
    case "cancel-resume":
      // Dismissing the plan also dismisses why it stopped.
      return { ...state, resume: undefined, blocked: undefined };
  }
}

function attachments(value: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(value) || value.length > 8) return undefined;
  const out: MessageAttachment[] = [];
  for (const item of value) {
    const row = item as Partial<MessageAttachment> | null;
    if (!row || typeof row.path !== "string" || typeof row.name !== "string") return undefined;
    out.push(row as MessageAttachment);
  }
  return out;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

/** Validate an op that arrived over IPC. Returns undefined for anything malformed. */
export function readFollowUpOp(value: unknown): FollowUpOp | undefined {
  const op = value as Record<string, unknown> | null;
  if (!op || typeof op !== "object") return undefined;
  switch (op.type) {
    case "add": {
      const prompt = op.prompt as Record<string, unknown> | null;
      const content = text(prompt?.content, 2_000_000);
      const files = attachments(prompt?.attachments ?? []);
      const skillId = prompt?.skillId === undefined ? undefined : text(prompt.skillId, 512);
      if (content === undefined || !files || (prompt?.skillId !== undefined && skillId === undefined)) return undefined;
      if (!content.trim() && files.length === 0) return undefined;
      return { type: "add", prompt: { content, attachments: files, ...(skillId ? { skillId } : {}) } };
    }
    case "remove": {
      const id = text(op.id, 256);
      return id ? { type: "remove", id } : undefined;
    }
    case "move": {
      const id = text(op.id, 256);
      return id && (op.direction === "up" || op.direction === "down") ? { type: "move", id, direction: op.direction } : undefined;
    }
    case "schedule": {
      const resume = op.resume as Record<string, unknown> | null;
      const runId = text(resume?.runId, 256);
      const prompt = text(resume?.prompt, 2_000_000);
      const files = attachments(resume?.attachments ?? []);
      const at = resume?.at;
      if (!runId || !prompt?.trim() || !files || typeof at !== "number" || !Number.isFinite(at)) return undefined;
      return { type: "schedule", resume: { runId, prompt, attachments: files, at } };
    }
    case "cancel-resume":
      return { type: "cancel-resume" };
    default:
      return undefined;
  }
}

/** Parse a stored record, dropping anything that is not a follow-up. */
export function readFollowUps(raw: string | undefined): FollowUps {
  if (!raw) return { queue: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<FollowUps> | null;
    const queue = Array.isArray(parsed?.queue)
      ? parsed.queue.filter((item): item is QueuedPrompt => Boolean(item && typeof item.id === "string" && typeof item.content === "string" && Array.isArray(item.attachments) && typeof item.createdAt === "string")).slice(0, FOLLOW_UP_LIMIT)
      : [];
    const resume = parsed?.resume && typeof parsed.resume.runId === "string" && typeof parsed.resume.prompt === "string" && typeof parsed.resume.at === "number" ? parsed.resume : undefined;
    return { queue, ...(resume ? { resume } : {}), ...(typeof parsed?.blocked === "string" ? { blocked: parsed.blocked } : {}) };
  } catch {
    return { queue: [] };
  }
}
