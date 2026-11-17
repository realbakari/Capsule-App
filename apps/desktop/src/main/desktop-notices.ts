import { coalesceNotices, type Notice } from "@capsule/shared";

export interface ShownNotice {
  close(): void;
}

export interface DesktopNoticeHost {
  show(notice: { title: string; body: string; silent: boolean; sessionId?: string }): ShownNotice | undefined;
  schedule(run: () => void, ms: number): unknown;
}

/** Long enough to catch threads settling together, short enough that a question still feels immediate. */
export const BURST_MS = 900;

interface Delivered {
  shown: ShownNotice;
  at: string;
  /** Threads it names that you have not opened since. It closes when none are left. */
  unread: Set<string>;
}

/**
 * Desktop notifications, one per burst and one per thread.
 *
 * Notices that arrive together go out as one. A thread's newer notice
 * replaces its older one, and a notice leaves Notification Center once you
 * have opened every thread it names, so the list there is what is still news.
 */
export class DesktopNotices {
  private pending: Array<{ notice: Notice; sound: boolean }> = [];
  private flushing = false;
  private readonly delivered = new Set<Delivered>();

  constructor(private readonly host: DesktopNoticeHost, private readonly now: () => string = () => new Date().toISOString()) {}

  push(notice: Notice, sound: boolean): void {
    this.pending.push({ notice, sound });
    if (this.flushing) return;
    this.flushing = true;
    this.host.schedule(() => this.flush(), BURST_MS);
  }

  /** Close what you have read: each thread counts as read once it was viewed after the notice went out. */
  viewed(viewedAt: (sessionId: string) => string | undefined): void {
    for (const entry of this.delivered) {
      for (const sessionId of entry.unread) {
        const at = viewedAt(sessionId);
        if (at && at >= entry.at) entry.unread.delete(sessionId);
      }
      if (entry.unread.size === 0) this.close(entry);
    }
  }

  private flush(): void {
    const batch = this.pending;
    this.pending = [];
    this.flushing = false;
    const notices = batch.map((item) => item.notice);
    const text = coalesceNotices(notices);
    if (!text) return;
    const threads = new Set(notices.flatMap((notice) => notice.sessionId ? [notice.sessionId] : []));
    for (const entry of this.delivered) {
      for (const sessionId of threads) entry.unread.delete(sessionId);
      if (entry.unread.size === 0) this.close(entry);
    }
    const shown = this.host.show({ ...text, silent: !batch.some((item) => item.sound) });
    if (shown && threads.size > 0) this.delivered.add({ shown, at: this.now(), unread: threads });
  }

  private close(entry: Delivered): void {
    this.delivered.delete(entry);
    try {
      entry.shown.close();
    } catch {
      // Already gone from Notification Center.
    }
  }
}
