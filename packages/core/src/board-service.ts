import {
  BOARD_DEPENDENCY_LIMIT,
  createsDependencyCycle,
  readyToAutoStart,
  type BoardCardOp,
  type BoardContext,
  type BoardRun,
  type CreateBoardCardInput,
  type CreateSessionInput,
  type Session,
} from "@capsule/shared";
import { titleFromPrompt } from "@capsule/sessions";

/**
 * Board cards and the chains between them.
 *
 * A card is a thread; a draft card is a thread holding the prompt it will
 * start with. Chains live here, in the main process, so a card marked done
 * starts what waits on it with the window closed, and a restart picks up
 * whatever was ready when the app quit.
 *
 * A card starts at most once: its pending prompt is cleared before it is sent,
 * and put back only when the send was refused before any turn was recorded.
 */

export interface BoardHost {
  getSession(id: string): Session | undefined;
  listSessions(): Session[];
  /** Writes only the card's own fields, never the rest of the thread. */
  saveCard(session: Pick<Session, "id" | "pendingStart" | "doneAt" | "updatedAt">): void;
  latestRuns(): ReadonlyMap<string, BoardRun>;
  /** A turn is running or being admitted in this thread. */
  isBusy(sessionId: string): boolean;
  createSession(input: CreateSessionInput): Promise<Session>;
  /** The same path as pressing send in the thread. */
  send(sessionId: string, prompt: string): Promise<void>;
  emit(): void;
  log(message: string): void;
  now(): string;
}

export class BoardService {
  private readonly starting = new Set<string>();
  private stopped = false;

  constructor(private readonly host: BoardHost) {}

  /** Create a card. Reusable by anything that makes cards, not only the board UI. */
  async createCard(input: CreateBoardCardInput): Promise<Session> {
    for (const id of input.dependsOn) {
      if (!this.host.getSession(id)) throw new Error("A card this one depends on no longer exists.");
    }
    const created = await this.host.createSession({
      projectId: input.projectId,
      title: input.title ?? titleFromPrompt(input.prompt),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.workspaceMode ? { workspaceMode: input.workspaceMode } : {}),
    });
    const session: Session = {
      ...created,
      pendingStart: { prompt: input.prompt, dependsOn: input.dependsOn, autoStart: input.autoStart, createdAt: this.host.now() },
      updatedAt: this.host.now(),
    };
    this.host.saveCard(session);
    this.host.emit();
    if (input.start) await this.startCard(session.id);
    else this.startReady();
    return this.host.getSession(session.id) ?? session;
  }

  async apply(sessionId: string, op: BoardCardOp): Promise<Session> {
    const session = this.host.getSession(sessionId);
    if (!session) throw new Error("That card no longer exists.");
    switch (op.type) {
      case "edit": {
        const pending = this.requireDraft(session);
        this.save({ ...session, pendingStart: {
          ...pending,
          ...(op.prompt !== undefined ? { prompt: op.prompt } : {}),
          ...(op.autoStart !== undefined ? { autoStart: op.autoStart } : {}),
          error: undefined,
        } });
        this.startReady();
        break;
      }
      case "link": {
        const pending = this.requireDraft(session);
        if (pending.dependsOn.includes(op.dependsOn)) break;
        if (!this.host.getSession(op.dependsOn)) throw new Error("That card no longer exists.");
        if (pending.dependsOn.length >= BOARD_DEPENDENCY_LIMIT) throw new Error(`A card can wait for at most ${BOARD_DEPENDENCY_LIMIT} others.`);
        const sessions = new Map(this.host.listSessions().map((item) => [item.id, item]));
        if (createsDependencyCycle(sessions, session.id, op.dependsOn)) {
          throw new Error("That link would make the cards wait for each other, so neither could start.");
        }
        // A draft that waited on nothing becomes a chained step, which starts on its own.
        const autoStart = pending.dependsOn.length === 0 ? true : pending.autoStart;
        this.save({ ...session, pendingStart: { ...pending, autoStart, dependsOn: [...pending.dependsOn, op.dependsOn] } });
        this.startReady();
        break;
      }
      case "unlink": {
        const pending = this.requireDraft(session);
        this.save({ ...session, pendingStart: { ...pending, dependsOn: pending.dependsOn.filter((id) => id !== op.dependsOn) } });
        break;
      }
      case "start":
        this.requireDraft(session);
        await this.startCard(session.id);
        break;
      case "done":
        if (session.pendingStart) throw new Error("This card has not started yet.");
        if (this.host.isBusy(session.id)) throw new Error("This card is still working. Stop it or wait for the turn to finish first.");
        if (!session.doneAt) this.save({ ...session, doneAt: this.host.now() });
        this.startReady();
        break;
      case "reopen":
        if (session.doneAt) this.save({ ...session, doneAt: undefined });
        break;
    }
    return this.host.getSession(sessionId) ?? session;
  }

  /** Recover after a restart: anything whose prerequisites were done when the app quit goes now. */
  start(): void {
    this.stopped = false;
    this.startReady();
  }

  stop(): void {
    this.stopped = true;
  }

  /** A deleted card no longer holds anything back. */
  forget(sessionId: string): void {
    for (const session of this.host.listSessions()) {
      const pending = session.pendingStart;
      if (!pending?.dependsOn.includes(sessionId)) continue;
      this.save({ ...session, pendingStart: { ...pending, dependsOn: pending.dependsOn.filter((id) => id !== sessionId) } });
    }
    this.startReady();
  }

  /** Start every draft that auto-starts and has nothing left to wait for. */
  startReady(): void {
    if (this.stopped) return;
    const sessions = this.host.listSessions();
    const context: BoardContext = { sessions: new Map(sessions.map((session) => [session.id, session])), latestRuns: this.host.latestRuns() };
    for (const session of sessions) {
      // A refusal is logged and kept on the card; nothing to rethrow to here.
      if (readyToAutoStart(session, context)) this.startCard(session.id).catch(() => undefined);
    }
  }

  private async startCard(sessionId: string): Promise<void> {
    if (this.stopped || this.starting.has(sessionId)) return;
    const session = this.host.getSession(sessionId);
    const pending = session?.pendingStart;
    if (!session || !pending) return;
    this.starting.add(sessionId);
    // Cleared before sending, so a second trigger finds nothing left to start.
    this.save({ ...session, pendingStart: undefined });
    try {
      await this.host.send(sessionId, pending.prompt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const current = this.host.getSession(sessionId);
      // Refused before a turn was recorded: the card goes back to waiting, with why.
      if (current && !current.pendingStart && !this.host.latestRuns().has(sessionId)) {
        this.save({ ...current, pendingStart: { ...pending, error: reason } });
      }
      this.host.log(`A board card could not start: ${reason}`);
      throw error;
    } finally {
      this.starting.delete(sessionId);
    }
  }

  private requireDraft(session: Session) {
    if (!session.pendingStart) throw new Error("This card has already started.");
    return session.pendingStart;
  }

  private save(session: Session): void {
    this.host.saveCard({ ...session, updatedAt: this.host.now() });
    this.host.emit();
  }
}
