export interface NativeUpdaterLike {
  checkForUpdates(): void;
  on(event: "update-downloaded", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "update-downloaded", listener: () => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * On macOS the library's downloaded event precedes Squirrel's local staging.
 * Stage explicitly before quitAndInstall: that method otherwise registers an
 * uncancellable future quit callback, even after a reported native error.
 */
export class NativeUpdateStager {
  private ready = false;
  private pending = false;

  constructor(private readonly native: NativeUpdaterLike, private readonly timeoutMs = 120_000) {
    native.on("update-downloaded", () => { this.ready = true; this.pending = false; });
    native.on("error", () => { this.pending = false; });
  }

  stage(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error("Update preparation was cancelled."));
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.native.removeListener("update-downloaded", downloaded);
        this.native.removeListener("error", failed);
        signal.removeEventListener("abort", aborted);
        if (error) reject(error); else resolve();
      };
      const downloaded = () => finish();
      const failed = (error: Error) => finish(error);
      const aborted = () => finish(new Error("Update preparation was cancelled."));
      const timer = setTimeout(() => finish(new Error("Native update preparation timed out. Retry restarting to install.")), this.timeoutMs);
      this.native.on("update-downloaded", downloaded);
      this.native.on("error", failed);
      signal.addEventListener("abort", aborted, { once: true });
      // Timing out a waiter does not cancel Squirrel. A retry joins that check
      // instead of starting another native download of the same local ZIP.
      if (!this.pending) {
        this.pending = true;
        try { this.native.checkForUpdates(); }
        catch (error) {
          this.pending = false;
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  }
}
