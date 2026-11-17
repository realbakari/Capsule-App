import type { RunStatus } from "@capsule/shared";

/** What a screen reader is told about the open thread: its latest turn and what waits on the user. */
export interface ThreadActivity {
  threadId?: string;
  /** The thread's newest run. */
  run?: { id: string; status: RunStatus };
  /** Requests waiting on the user, each with the sentence that names it. */
  requests: ReadonlyArray<{ id: string; question: boolean; agent: string; action: string }>;
}

export interface ThreadAnnouncementMemory {
  threadId?: string;
  run?: { id: string; status: RunStatus };
  requests: ReadonlySet<string>;
}

const OUTCOME: Partial<Record<RunStatus, string>> = {
  completed: "Reply finished.",
  failed: "The turn failed.",
  cancelled: "The turn stopped.",
  blocked: "The turn was blocked.",
};

const SETTLED = new Set<RunStatus>(["completed", "failed", "cancelled", "blocked"]);

/**
 * The next sentence for the thread's live region, or none. Only changes are
 * spoken: a turn that settles while watched, a request that newly waits. The
 * first look at a thread is a silent baseline, so opening one says nothing.
 */
export function nextThreadAnnouncement(previous: ThreadAnnouncementMemory | undefined, next: ThreadActivity): { memory: ThreadAnnouncementMemory; text?: string } {
  const memory: ThreadAnnouncementMemory = { threadId: next.threadId, run: next.run, requests: new Set(next.requests.map((request) => request.id)) };
  if (!previous || previous.threadId !== next.threadId) return { memory };
  const said: string[] = [];
  const run = next.run;
  // A run seen working that has now settled. One first seen settled is history loading in.
  if (run && previous.run?.id === run.id && !SETTLED.has(previous.run.status) && SETTLED.has(run.status) && OUTCOME[run.status]) said.push(OUTCOME[run.status]!);
  const fresh = next.requests.filter((request) => !previous.requests.has(request.id));
  if (fresh.length === 1) {
    const request = fresh[0]!;
    said.push(request.question ? `${request.agent} asked a question.` : `${request.agent} needs approval to ${request.action}.`);
  } else if (fresh.length > 1) said.push(`${fresh.length} requests are waiting for you.`);
  return { memory, text: said.length ? said.join(" ") : undefined };
}
