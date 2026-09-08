import type { FileEntry } from "@capsule/shared";
import { sameListing } from "./file-listing";

export interface DirectoryListing { entries?: FileEntry[]; loading: boolean; error?: string }

/** One cache per workspace identity. Old requests can only update their old cache. */
export class DirectoryListings {
  private snapshot: Record<string, DirectoryListing> = {};
  private readonly pending = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly read: (path: string) => Promise<FileEntry[]>) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;

  private publish(path: string, value: DirectoryListing) {
    this.snapshot = { ...this.snapshot, [path]: value };
    for (const listener of this.listeners) listener();
  }

  load(path: string, force = false): Promise<void> {
    const pending = this.pending.get(path);
    if (pending) return pending;
    const previous = this.snapshot[path];
    if (!force && previous?.entries && !previous.error) return Promise.resolve();
    this.publish(path, { ...previous, loading: true });
    const request = this.read(path).then((entries) => {
      this.publish(path, {
        entries: previous?.entries && sameListing(previous.entries, entries) ? previous.entries : entries,
        loading: false,
      });
    }).catch((error: unknown) => {
      this.publish(path, { entries: previous?.entries, loading: false, error: error instanceof Error ? error.message : String(error) });
    }).finally(() => this.pending.delete(path));
    this.pending.set(path, request);
    return request;
  }

  async refresh(paths: string[]): Promise<void> {
    // Bound concurrent filesystem reads even with many expanded folders.
    for (let index = 0; index < paths.length; index += 4) {
      await Promise.all(paths.slice(index, index + 4).map((path) => this.load(path, true)));
    }
  }
}
