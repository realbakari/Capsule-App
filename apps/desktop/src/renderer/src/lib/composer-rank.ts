/**
 * How well what was typed after `/` or `$` names an item. Lower is better;
 * undefined is no match. A name that is the query beats one that starts with
 * it, which beats a word inside the name, a run of letters inside it, the
 * letters in order, and last a match in the description alone.
 */
export const MATCH_RANK = { exact: 0, prefix: 1, word: 2, substring: 3, fuzzy: 4, description: 5 } as const;

const normalize = (text: string) => text.toLowerCase().replace(/^[/$]/u, "").replace(/[-_]+/gu, " ").trim();

function inOrder(query: string, name: string): boolean {
  let at = 0;
  for (const char of query.replace(/\s+/gu, "")) {
    at = name.indexOf(char, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

export function composerMatchRank(query: string, name: string, description = ""): number | undefined {
  const typed = normalize(query);
  if (!typed) return MATCH_RANK.exact;
  const label = normalize(name);
  if (label === typed) return MATCH_RANK.exact;
  if (label.startsWith(typed)) return MATCH_RANK.prefix;
  if (label.split(/[\s/.:]+/u).some((word) => word.startsWith(typed))) return MATCH_RANK.word;
  if (label.includes(typed)) return MATCH_RANK.substring;
  if (inOrder(typed, label)) return MATCH_RANK.fuzzy;
  const about = `${label} ${description.toLowerCase()}`;
  return typed.split(/\s+/u).every((term) => about.includes(term)) ? MATCH_RANK.description : undefined;
}

/** Matching items, best first; equal ranks keep the order they came in. */
export function rankMatches<T>(items: readonly T[], query: string, name: (item: T) => string, description?: (item: T) => string | undefined): T[] {
  return items
    .map((item, index) => ({ item, index, rank: composerMatchRank(query, name(item), description?.(item) ?? "") }))
    .filter((entry): entry is { item: T; index: number; rank: number } => entry.rank !== undefined)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Rank items that sit under group headings. Each group stays together so its
 * heading prints once, and the group holding the best match comes first.
 */
export function rankGrouped<T extends { group?: string }>(items: readonly T[], query: string, name: (item: T) => string, description?: (item: T) => string | undefined): T[] {
  const ranked = items
    .map((item, index) => ({ item, index, rank: composerMatchRank(query, name(item), description?.(item) ?? "") }))
    .filter((entry): entry is { item: T; index: number; rank: number } => entry.rank !== undefined);
  // Entries arrive in their original order, so a group's first index is its first entry's.
  const best = new Map<string | undefined, { rank: number; index: number }>();
  for (const entry of ranked) {
    const current = best.get(entry.item.group);
    if (!current || entry.rank < current.rank) best.set(entry.item.group, { rank: entry.rank, index: current?.index ?? entry.index });
  }
  const groupOf = (entry: { item: T }) => best.get(entry.item.group)!;
  return ranked
    .sort((a, b) => groupOf(a).rank - groupOf(b).rank || groupOf(a).index - groupOf(b).index || a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}
