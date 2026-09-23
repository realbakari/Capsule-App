/** Only the profile owner may start services; quitting waits for that start to settle. */
export class Startup {
  private pending?: Promise<void>;
  private cancelled = false;
  private ready = false;

  constructor(private readonly ownsProfile: boolean) {}

  get canOpenWindow(): boolean {
    return this.ownsProfile && this.ready && !this.cancelled;
  }

  run(boot: () => Promise<void>): Promise<void> {
    if (!this.ownsProfile || this.cancelled) return Promise.resolve();
    this.pending ??= Promise.resolve().then(async () => {
      if (this.cancelled) return;
      this.ready = true;
      await boot();
    });
    return this.pending;
  }

  cancel(): void { this.cancelled = true; }

  async settled(): Promise<void> {
    // Startup reports its own error. Cleanup still owns partially opened services.
    await this.pending?.catch(() => {});
  }
}
