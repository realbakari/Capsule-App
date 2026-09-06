import type { RemoteAccess } from "@capsule/shared";

/** Owns a single listener. A superseded start is stopped before it is exposed. */
export class RemoteAccessLifecycle<T extends { stop(): Promise<void> }> {
  handle: T | undefined;
  reach: RemoteAccess = "off";
  error: string | undefined;
  pairingUrl: string | undefined;
  private generation = 0;
  private pending = Promise.resolve();

  constructor(private readonly start: (reach: Exclude<RemoteAccess, "off">) => Promise<T>, private readonly changed: () => void) {}

  set(reach: RemoteAccess): Promise<void> {
    const generation = ++this.generation;
    this.pending = this.pending.then(async () => {
      if (generation !== this.generation) return;
      if (reach === this.reach && (reach === "off" || this.handle)) return;
      this.error = undefined;
      this.pairingUrl = undefined;
      try {
        // Keep ownership if stopping fails. Reporting Off while an owned
        // listener is still alive would be a false security guarantee.
        await this.handle?.stop();
        this.handle = undefined;
        this.reach = "off";
        if (reach !== "off" && generation === this.generation) {
          const started = await this.start(reach);
          this.handle = started;
          this.reach = reach;
          if (generation !== this.generation) {
            await started.stop();
            this.handle = undefined;
            this.reach = "off";
          }
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
      this.changed();
    });
    return this.pending;
  }
}
