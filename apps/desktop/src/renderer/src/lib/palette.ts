import { fuzzyScore } from "@capsule/shared";

/**
 * One row the command palette can offer. Every surface's commands are built
 * as these, so ranking, shortcuts and highlighting work the same for all.
 */
export interface PaletteEntry {
  id: string;
  label: string;
  group: string;
  detail?: string;
  /** Other words that should find this entry, matched below the label. */
  keywords?: string;
  /** A keybinding command id; its current chord is shown beside the label. */
  command?: string;
  disabledReason?: string;
  /** Hidden until the person types: lists that would swamp the empty palette. */
  searchOnly?: boolean;
  /** Selecting it opens another page of the palette instead of closing it. */
  keepOpen?: boolean;
  run: () => unknown;
}

export interface RankedEntry extends PaletteEntry {
  /** Label indices that matched the query, for highlighting. */
  matches: number[];
}

/* Below any label match: keywords only rescue an entry its label would miss. */
const KEYWORD_SCORE = 1;

/** Every query word starts some keyword. Looser than the label, which matches fuzzily. */
function keywordsMatch(query: string, keywords: string): boolean {
  const words = keywords.toLowerCase().split(/\s+/);
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((token) => words.some((word) => word.startsWith(token)));
}

/**
 * Orders the palette for a query. With no query, entries keep the order they
 * were given in. With one, each group keeps only its matches, best first, and
 * groups follow their best match so the top row is always the best answer.
 * `limits` caps a group (a long list of threads) after ranking, not before.
 */
export function rankPalette(entries: readonly PaletteEntry[], query: string, limits: Record<string, number> = {}): RankedEntry[] {
  if (!query.trim()) {
    const counts = new Map<string, number>();
    return entries.filter((entry) => {
      if (entry.searchOnly) return false;
      const count = (counts.get(entry.group) ?? 0) + 1;
      counts.set(entry.group, count);
      return count <= (limits[entry.group] ?? Infinity);
    }).map((entry) => ({ ...entry, matches: [] }));
  }

  const groups = new Map<string, Array<{ entry: RankedEntry; score: number; index: number }>>();
  entries.forEach((entry, index) => {
    const label = fuzzyScore(query, entry.label);
    const keywords = !label && entry.keywords ? keywordsMatch(query, `${entry.label} ${entry.keywords}`) : false;
    const score = label?.score ?? (keywords ? KEYWORD_SCORE : undefined);
    if (score === undefined) return;
    const list = groups.get(entry.group) ?? [];
    list.push({ entry: { ...entry, matches: label?.positions ?? [] }, score, index });
    groups.set(entry.group, list);
  });

  const ordered = [...groups.entries()].map(([group, list]) => {
    list.sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length || a.index - b.index);
    return { group, list: list.slice(0, limits[group] ?? Infinity), first: Math.min(...list.map((item) => item.index)) };
  });
  ordered.sort((a, b) => b.list[0]!.score - a.list[0]!.score
    || a.list[0]!.entry.label.length - b.list[0]!.entry.label.length || a.first - b.first);
  return ordered.flatMap(({ list }) => list.map((item) => item.entry));
}

/** Splits a label into plain and matched runs, for rendering highlights. */
export function highlightRuns(label: string, matches: readonly number[]): Array<{ text: string; match: boolean }> {
  if (!matches.length) return [{ text: label, match: false }];
  const hit = new Set(matches);
  const runs: Array<{ text: string; match: boolean }> = [];
  for (let index = 0; index < label.length; index++) {
    const match = hit.has(index);
    const last = runs.at(-1);
    if (last && last.match === match) last.text += label[index];
    else runs.push({ text: label[index]!, match });
  }
  return runs;
}
