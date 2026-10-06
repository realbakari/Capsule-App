/** Cooldowns apply to background reads only, never replaying a write. */
export class ReadBackoff {
  private readonly failures = new Map<string, { attempts: number; until: number; rateLimited: boolean }>();

  ready(key: string, force = false, now = Date.now()): boolean {
    const failure = this.failures.get(key);
    return !failure || now >= failure.until || (force && !failure.rateLimited);
  }

  failed(key: string, error: string, now = Date.now()): void {
    const attempts = Math.min((this.failures.get(key)?.attempts ?? 0) + 1, 6);
    const rateLimited = /rate limit|secondary rate|abuse detection/i.test(error);
    const delay = Math.min((rateLimited ? 60_000 : 30_000) * 2 ** (attempts - 1), 15 * 60_000);
    this.failures.set(key, { attempts, until: now + delay, rateLimited });
  }

  clear(key?: string): void {
    if (key === undefined) this.failures.clear();
    else this.failures.delete(key);
  }
}
