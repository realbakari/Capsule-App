import { fuzzyScore, nearMiss } from "@capsule/shared";

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
  /** Hidden until the person types: lists and power-user rows that would swamp the empty palette. */
  searchOnly?: boolean;
  /** Selecting it opens another page of the palette instead of closing it. */
  keepOpen?: boolean;
  /** When the thing last saw activity, in epoch milliseconds: recent ones rank a little higher. */
  recency?: number;
  run: () => unknown;
}

export interface RankedEntry extends PaletteEntry {
  /** Label indices that matched the query, for highlighting. */
  matches: number[];
}

/* Below any label match: keywords only rescue a word the label would miss. */
const KEYWORD_SCORE = 1;
/* A word that only matches with a typo counts for less than any exact one. */
const TYPO_SCORE = 0.5;
/* At most this much for activity right now, halving every day: enough to settle near-ties, never to beat a clearly better match. */
const RECENCY_BOOST = 2;
const RECENCY_HALF_LIFE_MS = 86_400_000;

function keywordWords(keywords: string | undefined): string[] {
  return keywords ? keywords.toLowerCase().split(/[\s\-_./]+/).filter(Boolean) : [];
}

/**
 * Each query word on its own, in any order: against the label fuzzily, then
 * as the start of a keyword, then (with `typos`) as a near miss of either.
 * Every word has to land somewhere.
 */
function matchEntry(words: readonly string[], entry: PaletteEntry, typos?: Map<string, boolean>): { score: number; positions: number[] } | undefined {
  let score = 0;
  const positions = new Set<number>();
  const keywords = keywordWords(entry.keywords);
  for (const word of words) {
    const label = fuzzyScore(word, entry.label);
    if (label) {
      score += label.score;
      for (const position of label.positions) positions.add(position);
    } else if (keywords.some((keyword) => keyword.startsWith(word))) score += KEYWORD_SCORE;
    else if (typos && (nearMiss(word, entry.label, typos) || nearMiss(word, entry.keywords ?? "", typos))) score += TYPO_SCORE;
    else return undefined;
  }
  return { score, positions: [...positions].sort((a, b) => a - b) };
}

function recencyBoost(recency: number | undefined, now: number): number {
  if (recency === undefined || !Number.isFinite(recency)) return 0;
  return RECENCY_BOOST * 0.5 ** (Math.max(0, now - recency) / RECENCY_HALF_LIFE_MS);
}

export interface RankOptions {
  /** Caps a group (a long list of threads) after ranking, not before. */
  limits?: Record<string, number>;
  /**
   * Groups of things to open rather than commands to run. On an equal match
   * they rank below commands, so "new" picks New conversation over a thread
   * whose title starts with "New".
   */
  content?: readonly string[];
  /** The clock recency is measured against. */
  now?: number;
}

/**
 * Orders the palette for a query. With no query, it lists what can run now:
 * search-only and disabled entries stay hidden, and each group appears once,
 * where its first entry was given. With a query, each group keeps only its
 * matches, best first, and groups follow their best match so the top row is
 * always the best answer. Disabled matches stay, showing why.
 */
export function rankPalette(entries: readonly PaletteEntry[], query: string, { limits = {}, content = [], now = Date.now() }: RankOptions = {}): RankedEntry[] {
  if (!query.trim()) {
    const groups = new Map<string, RankedEntry[]>();
    for (const entry of entries) {
      if (entry.searchOnly || entry.disabledReason) continue;
      const list = groups.get(entry.group) ?? [];
      if (list.length < (limits[entry.group] ?? Infinity)) list.push({ ...entry, matches: [] });
      groups.set(entry.group, list);
    }
    return [...groups.values()].flat();
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  type Scored = { entry: RankedEntry; score: number; rank: number; index: number };
  const collect = (typos?: Map<string, boolean>) => {
    const groups = new Map<string, Scored[]>();
    entries.forEach((entry, index) => {
      const match = matchEntry(words, entry, typos);
      if (!match) return;
      const list = groups.get(entry.group) ?? [];
      list.push({ entry: { ...entry, matches: match.positions }, score: match.score, rank: match.score + recencyBoost(entry.recency, now), index });
      groups.set(entry.group, list);
    });
    return groups;
  };
  /* Typos are forgiven only when nothing matches as typed, so they never crowd out a real hit. */
  let groups = collect();
  if (groups.size === 0) groups = collect(new Map());

  const isContent = (group: string) => Number(content.includes(group));
  const ordered = [...groups.entries()].map(([group, list]) => {
    list.sort((a, b) => b.rank - a.rank || (b.entry.recency ?? 0) - (a.entry.recency ?? 0)
      || a.entry.label.length - b.entry.label.length || a.index - b.index);
    const best = list.reduce((top, item) => (item.score > top.score ? item : top), list[0]!);
    return { group, list: list.slice(0, limits[group] ?? Infinity), best, first: Math.min(...list.map((item) => item.index)) };
  });
  ordered.sort((a, b) => b.best.score - a.best.score || isContent(a.group) - isContent(b.group)
    || a.best.entry.label.length - b.best.entry.label.length || a.first - b.first);
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
