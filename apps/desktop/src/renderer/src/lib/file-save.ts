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

export class FileSaveCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestContents = "";
  private revision = 0;
  private savedRevision = 0;
  private saving = false;
  private disposed = false;

  constructor(private readonly options: FileSaveOptions) {}

  change(contents: string): void {
    if (this.disposed) return;
    this.latestContents = contents;
    this.revision += 1;
    this.options.onPendingChange?.(true);
    this.schedule(this.options.debounceMs);
  }

  /** Write immediately — for an explicit Save, or before switching files. */
  async flush(): Promise<void> {
    this.clearTimer();
    await this.persistLatest();
  }

  /** Stop scheduling, but never silently discard unsaved text. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.revision !== this.savedRevision) void this.persistLatest();
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistLatest();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persistLatest(): Promise<void> {
    if (this.saving) return;
    if (this.revision === this.savedRevision) return;

    this.saving = true;
    const contents = this.latestContents;
    const revision = this.revision;
    try {
      await this.options.persist(contents);
      this.savedRevision = revision;
      this.options.onSaved?.(contents);
    } catch (error) {
      // Leave savedRevision behind so the next attempt retries this text
      // rather than treating it as written.
      this.options.onError?.(error);
    } finally {
      this.saving = false;
    }

    if (revision !== this.revision) {
      // Typed again while that write was in flight: go round once more.
      if (this.disposed) {
        await this.persistLatest();
      } else {
        this.schedule(this.options.debounceMs);
      }
      return;
    }
    if (this.revision === this.savedRevision) this.options.onPendingChange?.(false);
  }
}
