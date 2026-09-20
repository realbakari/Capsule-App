/** One optional request per connection/purpose; refresh cannot accumulate SDK promises. */
export class OptionalQuery {
  private started = false;
  private cancel?: () => void;

  run<T>(request: () => Promise<T>, timeoutMs = 3_000): Promise<T | undefined> {
    if (this.started) return Promise.resolve(undefined);
    this.started = true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancel = undefined;
        resolve(value);
      };
      const timer = setTimeout(() => finish(), timeoutMs);
      this.cancel = () => finish();
      // The SDK has no per-query abort. Both late fulfillment and rejection
      // are consumed, but a timed-out result can never escape this helper.
      void Promise.resolve().then(() => settled ? undefined : request()).then(finish, () => finish());
    });
  }

  close(): void {
    this.started = true;
    this.cancel?.();
  }
}
