import { readProjectIconDataUrl } from "@capsule/filesystem";

/** Bound both empty discovery results and encoded image bytes between shell reads. */
export class ProjectIconCache {
  private readonly entries = new Map<string, { value?: string; until: number; bytes: number }>();
  private bytes = 0;

  read(root?: string, customPath?: string, now = Date.now()): string | undefined {
    const key = JSON.stringify([root, customPath]);
    const cached = this.entries.get(key);
    if (cached && now < cached.until) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    this.remove(key);
    const value = readProjectIconDataUrl(root, customPath);
    const entry = { value, until: now + (value ? 60_000 : 5_000), bytes: (value?.length ?? 0) * 2 };
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    while (this.entries.size > 128 || this.bytes > 16 * 1024 * 1024) this.remove(this.entries.keys().next().value!);
    return value;
  }

  clear(): void { this.entries.clear(); this.bytes = 0; }

  private remove(key: string): void {
    this.bytes -= this.entries.get(key)?.bytes ?? 0;
    this.entries.delete(key);
  }
}
