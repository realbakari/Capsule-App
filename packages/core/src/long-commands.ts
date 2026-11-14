/**
 * Commands an agent ran without a person approving them, timed so Capsule can
 * say when one has been going for a while. Each command is reported once.
 */
export interface WatchedCommand {
  runId: string;
  sessionId: string;
  title: string;
}

export class LongCommandWatch {
  private readonly running = new Map<string, WatchedCommand & { startedAt: number; reported: boolean }>();

  /** A repeated start for the same id keeps the first start time. */
  start(id: string, startedAt: number, command: WatchedCommand): void {
    if (!this.running.has(id)) this.running.set(id, { ...command, startedAt, reported: false });
  }

  finish(id: string): void {
    this.running.delete(id);
  }

  finishRun(runId: string): void {
    for (const [id, command] of this.running) if (command.runId === runId) this.running.delete(id);
  }

  /** Commands that have run for at least `thresholdMs` by `now`, each returned only the first time. */
  overdue(now: number, thresholdMs: number): Array<WatchedCommand & { seconds: number }> {
    const due: Array<WatchedCommand & { seconds: number }> = [];
    for (const command of this.running.values()) {
      if (command.reported || now - command.startedAt < thresholdMs) continue;
      command.reported = true;
      due.push({ runId: command.runId, sessionId: command.sessionId, title: command.title, seconds: Math.floor((now - command.startedAt) / 1000) });
    }
    return due;
  }
}
