import {
  nextWake,
  nowIso,
  parseSnoozeUntil,
  unreadWatermark,
  type Run,
  type Session,
  type ThreadTriageAction,
} from "@capsule/shared";

export interface ThreadTriageHost {
  getSession(id: string): Session | undefined;
  listSessions(): Session[];
  latestRun(sessionId: string): Run | undefined;
  write(session: Session): void;
  /** Tell every window the thread list changed. */
  changed(): void;
  /** A snoozed thread's time came. */
  woke(session: Session): void;
}

/**
 * The person's triage of threads: read, settled, snoozed.
 *
 * One timer, aimed at the next snooze to end, rather than a poll: a thread
 * snoozed until 9:00 wakes at 9:00, and an idle app does no work.
 */
export class ThreadTriage {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private readonly host: ThreadTriageHost) {}

  start(): void {
    this.stopped = false;
    this.wakeDue();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  apply(sessionId: string, action: ThreadTriageAction): Session {
    const session = this.host.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    switch (action.kind) {
      case "viewed": {
        const at = action.at && Number.isFinite(Date.parse(action.at)) ? new Date(action.at).toISOString() : nowIso();
        // Viewing never moves the mark backwards; "mark unread" is the only way back.
        if (session.lastViewedAt && session.lastViewedAt >= at) return session;
        session.lastViewedAt = at;
        break;
      }
      case "unread": {
        const watermark = unreadWatermark(this.host.latestRun(session.id));
        if (!watermark) throw new Error("This conversation has no finished turn to mark unread.");
        session.lastViewedAt = watermark;
        break;
      }
      case "settle":
        session.settledAt = nowIso();
        session.snoozedUntil = undefined;
        break;
      case "unsettle":
        session.settledAt = undefined;
        break;
      case "snooze":
        session.snoozedUntil = parseSnoozeUntil(action.until);
        session.settledAt = undefined;
        break;
      case "wake":
        session.snoozedUntil = undefined;
        break;
    }
    this.host.write(session);
    this.host.changed();
    if (action.kind !== "viewed" && action.kind !== "unread") this.schedule();
    return session;
  }

  /** New work brings a thread back: a turn starting clears both shelves. */
  runStarted(sessionId: string): void {
    const session = this.host.getSession(sessionId);
    if (!session || (!session.settledAt && !session.snoozedUntil)) return;
    const wasSnoozed = Boolean(session.snoozedUntil);
    session.settledAt = undefined;
    session.snoozedUntil = undefined;
    this.host.write(session);
    this.host.changed();
    if (wasSnoozed) this.schedule();
  }

  private wakeDue(): void {
    if (this.stopped) return;
    const now = Date.now();
    let changed = false;
    for (const session of this.host.listSessions()) {
      if (!session.snoozedUntil) continue;
      const at = Date.parse(session.snoozedUntil);
      if (Number.isFinite(at) && at > now) continue;
      session.snoozedUntil = undefined;
      this.host.write(session);
      changed = true;
      if (session.state === "active") this.host.woke(session);
    }
    if (changed) this.host.changed();
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    const at = nextWake(this.host.listSessions());
    if (at === undefined) return;
    // setTimeout overflows past ~24.8 days; re-aim from there instead.
    const delay = Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1);
    this.timer = setTimeout(() => this.wakeDue(), delay);
    this.timer.unref?.();
  }
}
