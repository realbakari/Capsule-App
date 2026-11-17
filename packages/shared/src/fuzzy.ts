/**
 * A fuzzy subsequence match: every query character appears in the text, in
 * order. `positions` are the text indices that matched, for highlighting.
 */
export interface FuzzyMatch {
  score: number;
  positions: number[];
}

const MATCH = 1;
const WORD_START = 8;
const TEXT_START = 4;
const CONSECUTIVE = 6;
const GAP_OPEN = 3;
const GAP_EXTEND = 0.2;
const LEADING_GAP = 0.1;
const SEPARATORS = new Set([" ", "-", "_", ".", "/", "\\", ":", "(", "[", "@", "#", ",", "·"]);

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  if (SEPARATORS.has(previous)) return true;
  const current = text[index]!;
  return previous === previous.toLowerCase() && current !== current.toLowerCase();
}

/**
 * Scores `text` against `query`, or returns undefined when it is not a
 * subsequence. Matches at word starts and runs of consecutive characters score
 * higher; gaps cost a little. The best alignment wins, not the leftmost, so
 * "nc" in "New conversation" highlights both word starts.
 *
 * The first query character must land on a word start, so "rst" does not
 * find "conversation" by its middle letters. Whitespace in the query is
 * ignored, so "new conv" still matches.
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | undefined {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return { score: 0, positions: [] };
  const haystack = text.toLowerCase();
  const m = needle.length;
  const n = haystack.length;
  if (m > n) return undefined;

  const bonus = new Float64Array(n);
  for (let j = 0; j < n; j++) bonus[j] = MATCH + (isWordStart(text, j) ? WORD_START : 0) + (j === 0 ? TEXT_START : 0);

  /* best[i][j]: best score with needle[i] matched at text[j]; from[i][j]: where needle[i-1] matched. */
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n).fill(-Infinity);
    const back = new Int32Array(n).fill(-1);
    const previous = best[i - 1];
    /* Running max over k <= j-2 of previous[k] + GAP_EXTEND*k, for an affine gap cost. */
    let gapBest = -Infinity;
    let gapAt = -1;
    for (let j = i; j < n; j++) {
      if (haystack[j] !== needle[i]) {
        if (previous && j >= 1) {
          const k = j - 1;
          if (previous[k]! + GAP_EXTEND * k > gapBest) { gapBest = previous[k]! + GAP_EXTEND * k; gapAt = k; }
        }
        continue;
      }
      if (!previous) {
        if (isWordStart(text, j)) row[j] = bonus[j]! - LEADING_GAP * j;
      } else {
        const adjacent = j >= 1 ? previous[j - 1]! + CONSECUTIVE : -Infinity;
        const gapped = gapBest - GAP_OPEN - GAP_EXTEND * (j - 2);
        if (adjacent >= gapped && adjacent > -Infinity) { row[j] = adjacent + bonus[j]!; back[j] = j - 1; }
        else if (gapped > -Infinity) { row[j] = gapped + bonus[j]!; back[j] = gapAt; }
      }
      if (previous && j >= 1) {
        const k = j - 1;
        if (previous[k]! + GAP_EXTEND * k > gapBest) { gapBest = previous[k]! + GAP_EXTEND * k; gapAt = k; }
      }
    }
    best.push(row);
    from.push(back);
  }

  const last = best[m - 1]!;
  let end = -1;
  for (let j = m - 1; j < n; j++) if (last[j]! > -Infinity && (end < 0 || last[j]! > last[end]!)) end = j;
  if (end < 0) return undefined;
  const positions = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i--) { positions[i] = j; j = from[i]![j]!; }
  return { score: last[end]!, positions };
}

/**
 * Keeps the items that match and orders them best first. Ties go to the
 * shorter text, then to the input order, so callers can pre-sort by recency.
 */
export function rankFuzzy<T>(items: readonly T[], query: string, text: (item: T) => string): Array<{ item: T } & FuzzyMatch> {
  const ranked: Array<{ item: T; index: number; length: number } & FuzzyMatch> = [];
  items.forEach((item, index) => {
    const value = text(item);
    const match = fuzzyScore(query, value);
    if (match) ranked.push({ item, index, length: value.length, ...match });
  });
  ranked.sort((a, b) => b.score - a.score || a.length - b.length || a.index - b.index);
  return ranked.map(({ item, score, positions }) => ({ item, score, positions }));
}

/** Edits between two short words: a letter changed, added, dropped, or two neighbours swapped. Stops counting past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let smallest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, before[j - 2]! + 1);
      row.push(best);
      smallest = Math.min(smallest, best);
    }
    if (smallest > max) return max + 1;
    before = previous;
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * Whether `word` is a slip away from a word of `text`, or from that word's
 * start, so a half-typed word with a typo still counts. One slip, or two in a
 * word of eight letters or more; words under four letters must be exact. For a
 * fallback when nothing matches as typed. `seen` caches answers per text word
 * across one ranking, where the same words recur in many titles.
 */
export function nearMiss(word: string, text: string, seen?: Map<string, boolean>): boolean {
  const needle = word.toLowerCase();
  if (needle.length < 4) return false;
  const allowed = needle.length >= 8 ? 2 : 1;
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((candidate) => {
    const key = `${needle}\u0000${candidate}`;
    const known = seen?.get(key);
    if (known !== undefined) return known;
    let near = false;
    if (candidate.length >= needle.length - allowed) {
      for (const length of [needle.length - 1, needle.length, needle.length + 1, candidate.length]) {
        if (length > 0 && length <= candidate.length && editDistance(needle, candidate.slice(0, length), allowed) <= allowed) { near = true; break; }
      }
    }
    seen?.set(key, near);
    return near;
  });
}
