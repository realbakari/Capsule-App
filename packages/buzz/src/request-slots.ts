/** Bound subprocess concurrency without dropping ordinary overlapping reads.
 * Waiters belong to the connection signal and never survive disconnect. */
export class RequestSlots {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly limit = 4, private readonly maxWaiting = 64) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error("The channel connection changed."));
    if (this.active < this.limit) { this.active++; return Promise.resolve(this.release()); }
    if (this.waiting.length >= this.maxWaiting) return Promise.reject(new Error("Too many pending channel requests. Wait for the current requests to finish."));
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiting = this.waiting.filter((item) => item !== grant);
        reject(new Error("The channel connection changed."));
      };
      const grant = () => {
        signal.removeEventListener("abort", abort);
        this.active++; resolve(this.release());
      };
      signal.addEventListener("abort", abort, { once: true });
      this.waiting.push(grant);
    });
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true; this.active--;
      this.waiting.shift()?.();
    };
  }
}
