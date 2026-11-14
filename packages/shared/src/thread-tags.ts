import type { Session } from "./types.js";

/**
 * Tags are the user's own labels on threads, across projects. A tag is stored
 * in one canonical spelling, so "Bug", "#bug" and " bug " are the same tag and
 * rename and delete reach every thread that carries it.
 */

export const MAX_TAG_LENGTH = 32;
export const MAX_TAGS_PER_THREAD = 12;

export function normalizeTag(raw: string): string | undefined {
  const tag = raw.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_./-]/gu, "").slice(0, MAX_TAG_LENGTH);
  return tag || undefined;
}

/** Canonical, unique, sorted, and capped. */
export function normalizeTags(raw: readonly string[] | undefined): string[] {
  const tags = new Set<string>();
  for (const value of raw ?? []) {
    const tag = normalizeTag(value);
    if (tag) tags.add(tag);
  }
  return [...tags].sort().slice(0, MAX_TAGS_PER_THREAD);
}

export interface ThreadQuery {
  /** Lowercased free text, without the tag tokens. */
  text: string;
  /** Every tag a thread must carry. */
  tags: string[];
}

/** `tag:name` or `#name` anywhere in a search narrows it to threads with that tag. */
export function parseThreadQuery(query: string): ThreadQuery {
  const tags: string[] = [];
  const text = query.replace(/(?:^|\s)(?:tag:|#)(\S+)/giu, (_match, name: string) => {
    const tag = normalizeTag(name);
    if (tag) tags.push(tag);
    return " ";
  }).replace(/\s+/g, " ").trim().toLowerCase();
  return { text, tags: normalizeTags(tags) };
}

export function hasTags(session: Pick<Session, "tags">, tags: readonly string[]): boolean {
  return tags.every((tag) => session.tags?.includes(tag));
}

export interface TagCount {
  tag: string;
  count: number;
}

export function collectTags(sessions: readonly Pick<Session, "tags">[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const session of sessions) for (const tag of session.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((left, right) => left.tag.localeCompare(right.tag));
}

export interface TagGroup<T> {
  /** Undefined for threads without a tag. */
  tag?: string;
  threads: T[];
}

/**
 * The By tag view: one group per tag, alphabetical, then the untagged. A
 * thread with two tags is in both groups. Each group keeps the input order.
 */
export function groupThreadsByTag<T extends Pick<Session, "tags">>(sessions: readonly T[]): TagGroup<T>[] {
  const groups = new Map<string, T[]>();
  const untagged: T[] = [];
  for (const session of sessions) {
    if (!session.tags?.length) { untagged.push(session); continue; }
    for (const tag of session.tags) {
      const list = groups.get(tag) ?? [];
      list.push(session);
      groups.set(tag, list);
    }
  }
  const tagged: TagGroup<T>[] = [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([tag, threads]) => ({ tag, threads }));
  return untagged.length ? [...tagged, { threads: untagged }] : tagged;
}

/** A tag's new name on every thread; merging into an existing tag keeps one copy. */
export function renameTagIn(tags: readonly string[] | undefined, from: string, to: string): string[] | undefined {
  if (!tags?.includes(from)) return undefined;
  return normalizeTags(tags.map((tag) => tag === from ? to : tag));
}
