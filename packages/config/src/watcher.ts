import { statSync, unwatchFile, watch, watchFile, type FSWatcher, type Stats } from "node:fs";

export type WatchKind = "dir" | "file";

export interface ConfigWatcherOptions {
  /** Quiet period before a burst of changes is reported once. */
  debounceMs?: number;
  /** How often a path that does not exist yet is checked for. */
  pollMs?: number;
}

interface Watched {
  kind: WatchKind;
  /** Identity of the path the live watcher is attached to. */
  ino?: number;
  watcher?: FSWatcher;
  poll?: (current: Stats, previous: Stats) => void;
}

/**
 * Watches the folders and files settings come from and reports each burst of
 * changes once.
 *
 * A path that exists gets an `fs.watch` (recursive for folders). A path that
 * does not exist yet is polled, so a `.capsule` folder created later is found
 * without watching its parent: on macOS a folder watch streams events for the
 * whole tree beneath it, and a project root's tree includes its dependencies.
 * After every quiet period each watch is re-attached if its path was
 * replaced, which is how editors that save by rename are followed.
 */
export class ConfigWatcher {
  private readonly watched = new Map<string, Watched>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private readonly onSettle: () => void,
    private readonly options: ConfigWatcherOptions = {},
  ) {}

  add(target: string, kind: WatchKind): void {
    if (this.closed || this.watched.has(target)) return;
    this.watched.set(target, { kind });
    this.attach(target);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const target of this.watched.keys()) this.detach(target);
    this.watched.clear();
  }

  private schedule(): void {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.closed) return;
      for (const target of this.watched.keys()) this.attach(target);
      this.onSettle();
    }, this.options.debounceMs ?? 150);
    this.timer.unref?.();
  }

  private attach(target: string): void {
    const entry = this.watched.get(target);
    if (!entry) return;
    const ino = identity(target, entry.kind);
    if (ino !== undefined && entry.watcher && entry.ino === ino) return;
    if (ino === undefined && entry.poll) return;
    this.detach(target);
    if (ino === undefined) {
      entry.poll = (current, previous) => {
        if (current.ino !== previous.ino || current.mtimeMs !== previous.mtimeMs) this.schedule();
      };
      watchFile(target, { interval: this.options.pollMs ?? 1000, persistent: false }, entry.poll);
      return;
    }
    try {
      entry.watcher = this.open(target, entry.kind === "dir");
      entry.ino = ino;
      entry.watcher.on("error", () => {
        this.detach(target);
        this.schedule();
      });
    } catch {
      // Gone between the stat and the watch: the next settle will poll it.
      this.schedule();
    }
  }

  private open(target: string, recursive: boolean): FSWatcher {
    const listener = () => this.schedule();
    try {
      return watch(target, { recursive, persistent: false }, listener);
    } catch (error) {
      if (!recursive) throw error;
      return watch(target, { persistent: false }, listener);
    }
  }

  private detach(target: string): void {
    const entry = this.watched.get(target);
    if (!entry) return;
    entry.watcher?.close();
    if (entry.poll) unwatchFile(target, entry.poll);
    entry.watcher = undefined;
    entry.poll = undefined;
    entry.ino = undefined;
  }
}

function identity(target: string, kind: WatchKind): number | undefined {
  try {
    const stats = statSync(target);
    return (kind === "dir" ? stats.isDirectory() : stats.isFile()) ? stats.ino : undefined;
  } catch {
    return undefined;
  }
}
