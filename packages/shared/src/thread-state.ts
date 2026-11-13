import type { Run, Session } from "./types.js";

/**
 * Where a thread sits in the person's triage, apart from what its agent is
 * doing.
 *
 * Run status says what the agent did. These say what the person did about
 * it: whether they have read the latest finished turn, whether they called
 * the thread done (settled), and whether they asked not to see it until a
 * time (snoozed). Archive is a fourth answer and stays `Session.state`.
 *
 * Work coming back to a thread beats both shelves: a new turn clears them,
 * and a turn waiting on a decision is never hidden by either.
 */
export type ThreadShelf = "active" | "settled" | "snoozed";

/** A write to a thread's triage state. The engine is the only writer. */
export type ThreadTriageAction =
  | { kind: "viewed"; at?: string }
  | { kind: "unread" }
  | { kind: "settle" }
  | { kind: "unsettle" }
  | { kind: "snooze"; until: string }
  | { kind: "wake" };

const SETTLED_RUN_STATUSES = new Set<Run["status"]>(["completed", "failed"]);

type RunMark = Pick<Run, "status" | "completedAt" | "updatedAt">;

/** When the latest turn finished, if it has and left something to read. */
export function finishedAt(run: RunMark | undefined): string | undefined {
  if (!run || !SETTLED_RUN_STATUSES.has(run.status)) return undefined;
  return run.completedAt ?? run.updatedAt;
}

/**
 * Whether the latest turn finished after the person last looked.
 *
 * A thread with no `lastViewedAt` predates the field; the migration stamps
 * every existing row, so absence here means "never opened" for a thread the
 * engine created without one, which reads as unread once a turn finishes.
 */
export function isThreadUnread(session: Pick<Session, "lastViewedAt">, latest: RunMark | undefined): boolean {
  const finished = finishedAt(latest);
  if (!finished) return false;
  return !session.lastViewedAt || finished > session.lastViewedAt;
}

export function threadShelf(
  session: Pick<Session, "settledAt" | "snoozedUntil">,
  now: number = Date.now(),
): ThreadShelf {
  if (session.snoozedUntil && Date.parse(session.snoozedUntil) > now) return "snoozed";
  if (session.settledAt) return "settled";
  return "active";
}

/** The next moment a snoozed thread in this list wakes, for one precise timer. */
export function nextWake(sessions: readonly Pick<Session, "snoozedUntil" | "state">[], now: number = Date.now()): number | undefined {
  let next: number | undefined;
  for (const session of sessions) {
    if (session.state !== "active" || !session.snoozedUntil) continue;
    const at = Date.parse(session.snoozedUntil);
    if (!Number.isFinite(at)) continue;
    if (next === undefined || at < next) next = Math.max(at, now);
  }
  return next;
}

/**
 * The value `lastViewedAt` takes for "mark unread": a millisecond before the
 * latest turn finished, so that turn reads as new and nothing older does.
 */
export function unreadWatermark(latest: RunMark | undefined): string | undefined {
  const finished = finishedAt(latest);
  if (!finished) return undefined;
  const at = Date.parse(finished);
  return Number.isFinite(at) ? new Date(at - 1).toISOString() : undefined;
}

export interface SnoozePreset {
  id: "later-today" | "this-evening" | "tomorrow" | "next-week";
  label: string;
  at: Date;
}

/**
 * Snooze times a person thinks in, computed from now in local time.
 *
 * "Later today" is three hours on, rounded up to the hour. Morning presets
 * land at 9:00, the evening at 18:00. Presets that would land in the past or
 * within the hour are dropped rather than offered and then refused.
 */
export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
  const at = (days: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date;
  };
  const later = new Date(now);
  later.setHours(later.getHours() + 3, 0, 0, 0);
  if (later.getTime() - now.getTime() < 3 * 3_600_000) later.setHours(later.getHours() + 1);
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  const presets: SnoozePreset[] = [
    { id: "later-today", label: "Later today", at: later },
    { id: "this-evening", label: "This evening", at: at(0, 18) },
    { id: "tomorrow", label: "Tomorrow", at: at(1, 9) },
    { id: "next-week", label: "Next week", at: at(daysToMonday, 9) },
  ];
  const sameDay = (date: Date) => date.toDateString() === now.toDateString();
  return presets.filter((preset) => {
    if (preset.at.getTime() - now.getTime() < 3_600_000) return false;
    if (preset.id === "later-today" && !sameDay(preset.at)) return false;
    return !(preset.id === "this-evening" && preset.at.getTime() <= later.getTime());
  });
}

/** Parse a person's custom snooze time; refuses the past and the far future. */
export function parseSnoozeUntil(value: string, now: number = Date.now()): string {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new Error("Choose a valid time to snooze until.");
  if (at <= now + 30_000) throw new Error("Choose a time in the future.");
  if (at > now + 366 * 86_400_000) throw new Error("Snooze for at most a year.");
  return new Date(at).toISOString();
}

/** The IPC boundary: anything that is not a known action is refused. */
export function parseThreadTriageAction(value: unknown): ThreadTriageAction {
  const input = (value ?? {}) as Record<string, unknown>;
  switch (input.kind) {
    case "viewed":
      return typeof input.at === "string" ? { kind: "viewed", at: input.at } : { kind: "viewed" };
    case "unread":
    case "settle":
    case "unsettle":
    case "wake":
      return { kind: input.kind };
    case "snooze":
      if (typeof input.until === "string") return { kind: "snooze", until: input.until };
      break;
  }
  throw new Error("Invalid conversation triage request.");
}
