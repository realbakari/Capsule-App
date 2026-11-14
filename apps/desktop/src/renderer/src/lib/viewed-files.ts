import type { DiffFile } from "@capsule/shared";

/*
 * "Viewed" marks in Review. A mark belongs to one thread, one file and one
 * version of that file's diff: when the diff changes, the hash changes and the
 * file reads as unviewed again. Several versions of a path can be marked at
 * once, so marking a turn's copy does not clear the working tree's.
 */

export const VIEWED_STORAGE_KEY = "capsule.review.viewed.v1";
const MAX_THREADS = 40;
const MAX_MARKS_PER_THREAD = 1000;

/** thread → `${path}\0${hash}` → when it was marked. */
export type ViewedStore = Record<string, Record<string, number>>;

/** FNV-1a over everything the reader sees for this file. */
export function diffFileHash(file: DiffFile): string {
  let hash = 0x811c9dc5;
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193);
  };
  feed(file.status);
  feed(file.oldPath ?? "");
  feed(file.path);
  feed(file.binary ? "binary" : "text");
  for (const hunk of file.hunks) {
    feed(hunk.header);
    for (const line of hunk.lines) feed(`${line.kind}:${line.text}`);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function viewedKey(file: DiffFile, hash = diffFileHash(file)): string {
  return `${file.path}\0${hash}`;
}

export function parseViewedStore(raw: string | null): ViewedStore {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const store: ViewedStore = {};
    for (const [thread, marks] of Object.entries(value as Record<string, unknown>)) {
      if (!marks || typeof marks !== "object" || Array.isArray(marks)) continue;
      const kept: Record<string, number> = {};
      for (const [key, at] of Object.entries(marks as Record<string, unknown>)) {
        if (typeof at === "number" && Number.isFinite(at)) kept[key] = at;
      }
      store[thread] = kept;
    }
    return store;
  } catch {
    return {};
  }
}

function newest(marks: Record<string, number>): number {
  let latest = 0;
  for (const at of Object.values(marks)) latest = Math.max(latest, at);
  return latest;
}

/** A new store with one mark set or cleared, trimmed to its bounds. */
export function setViewed(store: ViewedStore, thread: string, key: string, viewed: boolean, now = Date.now()): ViewedStore {
  const marks = { ...(store[thread] ?? {}) };
  if (viewed) marks[key] = now;
  else delete marks[key];
  const entries = Object.entries(marks);
  const trimmed = entries.length > MAX_MARKS_PER_THREAD
    ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_MARKS_PER_THREAD))
    : marks;
  const next: ViewedStore = { ...store };
  if (Object.keys(trimmed).length) next[thread] = trimmed;
  else delete next[thread];
  const threads = Object.keys(next);
  if (threads.length <= MAX_THREADS) return next;
  const keep = new Set(threads.sort((a, b) => newest(next[b]!) - newest(next[a]!)).slice(0, MAX_THREADS));
  return Object.fromEntries(Object.entries(next).filter(([name]) => keep.has(name)));
}

export function readViewedStore(storage: Pick<Storage, "getItem"> | undefined): ViewedStore {
  try {
    return parseViewedStore(storage?.getItem(VIEWED_STORAGE_KEY) ?? null);
  } catch {
    return {};
  }
}

export function writeViewedStore(storage: Pick<Storage, "setItem"> | undefined, store: ViewedStore): void {
  try {
    storage?.setItem(VIEWED_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* A full or blocked store keeps the marks for this window only. */
  }
}
