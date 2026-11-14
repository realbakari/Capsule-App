import {
  applyFollowUpOp,
  detectUsageLimit,
  readFollowUps,
  type FollowUpOp,
  type FollowUpPrompt,
  type FollowUps,
  type MessageAttachment,
  type Run,
} from "@capsule/shared";

/**
 * Sends a conversation's queued follow-ups and scheduled resumes.
 *
 * These used to live in the window: the renderer drained the queue of the
 * thread on screen only, so a follow-up queued in one thread waited until
 * someone opened it again, and a "resume at reset" never fired in a thread
 * nobody was looking at, or with the window closed. The engine knows when
 * every conversation's turn ends, so it sends them.
 */

export interface FollowUpHost {
  read(key: string): string | undefined;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(prefix: string): string[];
  sessionExists(sessionId: string): boolean;
  /** A turn is running or being admitted in this conversation. */
  isBusy(sessionId: string): boolean;
  send(sessionId: string, prompt: FollowUpPrompt): Promise<void>;
  /** Why a turn cannot start now. Sending anyway records a turn that fails. */
  blocker(sessionId: string): string | undefined;
  emit(sessionId: string, state: FollowUps): void;
  autoResume(): boolean;
  /** The conversation's turns, newest first. */
  recentRuns(sessionId: string): Run[];
  /** The stopped turn's own files, from its prompt message. */
  attachmentsFor(runId: string): MessageAttachment[];
  log(message: string): void;
}

const PREFIX = "followups:";
/** Automatic resumes allowed in a row before a conversation waits for the person. */
export const AUTO_RESUME_LIMIT = 3;
export const AUTO_RESUME_MIN_WAIT_MS = 60_000;

export class FollowUpService {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly sending = new Set<string>();
  private readonly handledLimits = new Set<string>();
  private ticker?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly host: FollowUpHost,
    private readonly options: { settleMs?: number; retryMs?: number; tickMs?: number; now?: () => number } = {},
  ) {}

  private get now(): number { return this.options.now?.() ?? Date.now(); }

  get(sessionId: string): FollowUps {
    return readFollowUps(this.host.read(PREFIX + sessionId));
  }

  apply(sessionId: string, op: FollowUpOp): FollowUps {
    if (!this.host.sessionExists(sessionId)) throw new Error("That conversation no longer exists.");
    const next = applyFollowUpOp(this.get(sessionId), op, new Date(this.now));
    this.save(sessionId, next);
    if (op.type === "add" || op.type === "remove") this.schedule(sessionId, this.options.settleMs ?? 1_500);
    return next;
  }

  /** Resume sending everything left from the last run of the app. */
  start(): void {
    this.stopped = false;
    for (const key of this.host.keys(PREFIX)) this.schedule(key.slice(PREFIX.length), this.options.settleMs ?? 1_500);
    this.ticker = setInterval(() => this.tick(), this.options.tickMs ?? 30_000);
    this.ticker.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  forget(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
    this.host.remove(PREFIX + sessionId);
  }

  /** A turn in this conversation ended: the next follow-up may go, and a limit stop may schedule itself. */
  runEnded(run: Run): void {
    if (run.status === "failed") this.considerAutoResume(run);
    if (run.status === "completed") {
      const state = this.get(run.sessionId);
      // A turn that went through answers whatever had stopped it.
      if (state.blocked && state.queue.length === 0) this.save(run.sessionId, { ...state, blocked: undefined });
    }
    this.schedule(run.sessionId, this.options.settleMs ?? 1_500);
  }

  private save(sessionId: string, state: FollowUps): void {
    if (state.queue.length === 0 && !state.resume && !state.blocked) this.host.remove(PREFIX + sessionId);
    else this.host.write(PREFIX + sessionId, JSON.stringify(state));
    this.host.emit(sessionId, state);
  }

  private schedule(sessionId: string, delayMs: number): void {
    if (this.stopped) return;
    const existing = this.timers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.drain(sessionId);
    }, delayMs);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  private tick(): void {
    for (const key of this.host.keys(PREFIX)) {
      const sessionId = key.slice(PREFIX.length);
      const state = this.get(sessionId);
      if (state.resume && state.resume.at <= this.now) {
        const { resume } = state;
        try {
          this.save(sessionId, applyFollowUpOp(applyFollowUpOp(state, { type: "cancel-resume" }), {
            type: "add",
            prompt: { content: resume.prompt, attachments: resume.attachments ?? [] },
          }, new Date(this.now)));
        } catch (error) {
          this.save(sessionId, { ...state, resume: undefined, blocked: error instanceof Error ? error.message : String(error) });
        }
      }
      if (this.get(sessionId).queue.length > 0) void this.drain(sessionId);
    }
  }

  /** Exposed for tests; the timers call it. */
  async drain(sessionId: string): Promise<void> {
    if (this.stopped || this.sending.has(sessionId)) return;
    if (!this.host.sessionExists(sessionId)) {
      this.forget(sessionId);
      return;
    }
    // The run that ends will settle this conversation again.
    if (this.host.isBusy(sessionId)) return;
    const state = this.get(sessionId);
    const [next, ...rest] = state.queue;
    if (!next) return;
    // Ask first: a send that cannot start still records the prompt and a failed turn.
    const blocked = this.host.blocker(sessionId);
    if (blocked) {
      if (state.blocked !== blocked) this.save(sessionId, { ...state, blocked });
      this.schedule(sessionId, this.options.retryMs ?? 30_000);
      return;
    }
    this.sending.add(sessionId);
    this.save(sessionId, { ...state, queue: rest, blocked: undefined });
    try {
      await this.host.send(sessionId, { content: next.content, attachments: next.attachments, ...(next.skillId ? { skillId: next.skillId } : {}) });
    } catch (error) {
      const current = this.get(sessionId);
      const blocked = error instanceof Error ? error.message : String(error);
      /*
       * A hook refused this text. Sending it again gets the same answer and
       * runs the hook every retry, so it leaves the queue, and the reason
       * stays until the next turn goes through.
       */
      if (error instanceof Error && error.name === "PromptBlockedError") {
        this.save(sessionId, { ...current, queue: current.queue.filter((item) => item.id !== next.id), blocked: `${blocked} The queued message was removed.` });
        return;
      }
      // Back to the front, with the reason, and tried again later: never dropped.
      this.save(sessionId, { ...current, queue: [next, ...current.queue.filter((item) => item.id !== next.id)], blocked });
      this.host.log(`A queued follow-up could not be sent yet: ${blocked}`);
      this.schedule(sessionId, this.options.retryMs ?? 30_000);
    } finally {
      this.sending.delete(sessionId);
    }
  }

  private considerAutoResume(run: Run): void {
    if (!this.host.autoResume() || !run.prompt || this.handledLimits.has(run.id)) return;
    const limit = detectUsageLimit(run.error);
    if (!limit.limited || !limit.resetsAt) return;
    this.handledLimits.add(run.id);
    const state = this.get(run.sessionId);
    if (state.resume) return;
    /*
     * A limit that keeps answering "retry in 5 seconds" would resend forever.
     * Stop after a few limit stops in a row, and never resume sooner than a
     * minute out.
     */
    let streak = 0;
    for (const item of this.host.recentRuns(run.sessionId)) {
      if (item.status !== "failed" || !detectUsageLimit(item.error).limited) break;
      streak += 1;
    }
    if (streak > AUTO_RESUME_LIMIT) {
      this.save(run.sessionId, { ...state, blocked: "Auto-resume stopped after several usage-limit stops in a row. Retry when the limit has lifted." });
      return;
    }
    this.save(run.sessionId, applyFollowUpOp(state, {
      type: "schedule",
      resume: { runId: run.id, prompt: run.prompt, attachments: this.host.attachmentsFor(run.id), at: Math.max(limit.resetsAt.getTime(), this.now + AUTO_RESUME_MIN_WAIT_MS) },
    }));
  }
}
