import type { FollowUpPrompt, MessageAttachment, Run, Session } from "@capsule/shared";

export interface InterruptedTurn {
  run: Pick<Run, "id" | "sessionId" | "prompt" | "createdAt">;
  /** Who was carrying the turn when the app quit, read before the keys were cleared. */
  route: "direct" | "gateway" | "local";
}

/** Older than this, an interrupted turn is history, not work to pick up. */
export const CONTINUE_WITHIN_MS = 24 * 3_600_000;

export const RESTART_PREAMBLE =
  "Capsule restarted before you finished this turn. Pick up where you left off; anything you already changed is still on disk.";

/**
 * Which interrupted turns to send again after a restart, as queued
 * follow-ups the person can see and remove.
 *
 * One per thread: its latest interrupted turn. Gateway turns are left alone,
 * because the Gateway may still be running them and sending again would do
 * the work twice. Archived threads and old turns are left alone too.
 */
export function continuationsAfterRestart(
  turns: readonly InterruptedTurn[],
  sessions: readonly Pick<Session, "id" | "state">[],
  attachmentsFor: (runId: string) => MessageAttachment[],
  now = Date.now(),
): Array<{ sessionId: string; prompt: FollowUpPrompt }> {
  const active = new Set(sessions.filter((session) => session.state === "active").map((session) => session.id));
  const latest = new Map<string, InterruptedTurn>();
  for (const turn of turns) {
    const previous = latest.get(turn.run.sessionId);
    if (!previous || turn.run.createdAt > previous.run.createdAt) latest.set(turn.run.sessionId, turn);
  }
  const out: Array<{ sessionId: string; prompt: FollowUpPrompt }> = [];
  for (const [sessionId, turn] of latest) {
    if (turn.route === "gateway" || !active.has(sessionId)) continue;
    if (now - Date.parse(turn.run.createdAt) > CONTINUE_WITHIN_MS) continue;
    const original = turn.run.prompt.trim();
    out.push({
      sessionId,
      prompt: { content: original ? `${RESTART_PREAMBLE}\n\n${original}` : RESTART_PREAMBLE, attachments: attachmentsFor(turn.run.id) },
    });
  }
  return out;
}
