/** Give owned processes time to exit without letting a stuck cleanup trap Quit. */
export class Shutdown {
  started = false;
  ready = false;
  private pending?: Promise<void>;

  constructor(
    private readonly cleanup: () => Promise<void>,
    private readonly report: (error: unknown) => void,
    private readonly deadlineMs = 12_000,
  ) {}

  request(): Promise<void> {
    if (this.pending) return this.pending;
    this.started = true;
    this.pending = this.finish();
    return this.pending;
  }

  private async finish(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Attach the rejection handler even if the deadline wins the race.
    const cleanup = Promise.resolve().then(this.cleanup).catch(this.report);
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.report(new Error("Shutdown cleanup exceeded its deadline; Capsule will quit."));
        resolve();
      }, this.deadlineMs);
    });
    try { await Promise.race([cleanup, deadline]); }
    finally { clearTimeout(timer); this.ready = true; }
  }
}
