export interface FileOwner { projectId: string; root: string; path: string }
export interface FileDraft {
  owner: FileOwner;
  contents: string;
  revision?: string;
  state: "pending" | "error" | "conflict";
}

export const fileOwnerKey = (owner: FileOwner) => JSON.stringify([owner.projectId, owner.root, owner.path]);

/** Unsaved work outlives a preview. Never evict dirty text to make room. */
export class FileDraftStore {
  private readonly drafts = new Map<string, FileDraft>();
  private readonly listeners = new Set<() => void>();
  private snapshot: FileDraft[] = [];
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(): void {
    this.snapshot = [...this.drafts.values()];
    for (const listener of this.listeners) listener();
  }
  constructor(private readonly maxEntries = 32, private readonly maxBytes = 16 * 1024 * 1024) {}

  get(owner: FileOwner): FileDraft | undefined { return this.drafts.get(fileOwnerKey(owner)); }
  list(): FileDraft[] { return [...this.drafts.values()]; }

  change(owner: FileOwner, contents: string, revision?: string): boolean {
    const key = fileOwnerKey(owner);
    const previous = this.drafts.get(key);
    const bytes = this.list().reduce((total, draft) => total + draft.contents.length * 2, 0);
    if ((!previous && this.drafts.size >= this.maxEntries)
      || bytes - (previous?.contents.length ?? 0) * 2 + contents.length * 2 > this.maxBytes) return false;
    this.drafts.set(key, { owner, contents, revision: previous ? previous.revision : revision, state: "pending" });
    this.publish();
    return true;
  }

  saved(owner: FileOwner, contents: string, revision?: string): void {
    const draft = this.get(owner);
    if (!draft) return;
    if (draft.contents === contents) this.discard(owner);
    else { draft.revision = revision; this.publish(); }
  }

  failed(owner: FileOwner, conflict: boolean): void {
    const draft = this.get(owner);
    if (draft) { draft.state = conflict ? "conflict" : "error"; this.publish(); }
  }

  discard(owner: FileOwner): void { if (this.drafts.delete(fileOwnerKey(owner))) this.publish(); }
}

// Renderer-session memory only: source text never enters preferences or logs.
export const fileDrafts = new FileDraftStore();
