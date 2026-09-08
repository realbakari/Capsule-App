/*
 * Mirrors FILE_CHANGED_ON_DISK in @capsule/shared. It is duplicated rather than
 * imported because the renderer cannot pull values from that package — its
 * root reaches node:crypto, which will not bundle for a browser context.
 */
export const FILE_CHANGED_ON_DISK = "FILE_CHANGED_ON_DISK";

export function isConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(FILE_CHANGED_ON_DISK);
}

/*
 * Debounced write-back for the file editor.
 *
 * The subtlety is not the debounce — it is what happens to edits made *while*
 * a save is in flight. A naive "save on idle" either drops them or races two
 * writes onto the same file. A revision counter records the keystroke a save
 * started from; if it no longer matches when the write returns, newer text
 * exists and another save is scheduled. Only one write is ever in flight.
 */
export interface FileSaveOptions {
  debounceMs: number;
  persist: (contents: string) => Promise<void>;
  /** Fires with true on the first unsaved keystroke, false once settled. */
  onPendingChange?: (pending: boolean) => void;
  onSaved?: (contents: string) => void;
  onError?: (error: unknown) => void;
}

export type FileSaveOutcome = { status: "saved" } | { status: "failed"; error: unknown } | { status: "discarded" };

export class FileSaveCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestContents = "";
  private revision = 0;
  private savedRevision = 0;
  private inFlight?: Promise<FileSaveOutcome>;
  private disposed = false;
  private discarded = false;
  private paused = false;

  constructor(private readonly options: FileSaveOptions) {}

  change(contents: string): void {
    if (this.disposed) return;
    this.latestContents = contents;
    this.paused = false;
    this.revision += 1;
    this.options.onPendingChange?.(true);
    this.schedule(this.options.debounceMs);
  }

  /** Write immediately — for an explicit Save, or before switching files. */
  async flush(): Promise<FileSaveOutcome> {
    this.clearTimer();
    this.paused = false;
    // One promise owns the whole drain, including edits entered during a write.
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.persistLatest();
    try { return await this.inFlight; }
    finally { this.inFlight = undefined; }
  }

  /** Stop scheduling, but never silently discard unsaved text. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (!this.paused && this.revision !== this.savedRevision) void this.flush();
  }

  /** Explicit discard stops queued edits; an acknowledged disk write is not undone. */
  discard(): void {
    this.discarded = true;
    this.disposed = true;
    this.clearTimer();
  }

  /** Expose recovered text without retrying a failed save before the user decides. */
  pause(): void { this.paused = true; this.clearTimer(); }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persistLatest(): Promise<FileSaveOutcome> {
    while (!this.discarded && this.revision !== this.savedRevision) {
      const contents = this.latestContents;
      const revision = this.revision;
      try {
        await this.options.persist(contents);
        this.savedRevision = revision;
        if (!this.discarded) this.options.onSaved?.(contents);
      } catch (error) {
        this.paused = true;
        // Failed text remains owned by the draft store. A conflict must not spin.
        if (!this.discarded) this.options.onError?.(error);
        return { status: "failed", error };
      }
    }
    if (this.discarded) return { status: "discarded" };
    this.options.onPendingChange?.(false);
    return { status: "saved" };
  }
}
